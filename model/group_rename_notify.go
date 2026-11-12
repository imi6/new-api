package model

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// 分组改名每推进一步都通过 Redis 通知其他节点立即重新加载配置并上报版本，
// 不必等 SyncFrequency 的定时同步。通知丢失时定时同步仍会兜底，只是慢一些。

var (
	groupRenameNotifyOrigin = common.GetRandomString(16)
	groupRenameSubscriber   sync.Once
	groupRenameReloadMu     sync.Mutex
)

func groupRenameTopic(database int) string {
	// Redis Pub/Sub 跨逻辑库生效，带上库号，避免共用 Redis 的独立部署互相通知。
	return fmt.Sprintf("new-api:group-rename:db:%d", database)
}

// notifyGroupRenameRevision 在改名版本变化并提交后通知其他节点。
func notifyGroupRenameRevision() {
	rdb := common.RDB
	if !common.RedisEnabled || rdb == nil {
		return
	}
	payload := groupRenameNotifyOrigin + ":" + strconv.FormatInt(common.GroupRenameAliasRevision(), 10)
	if err := rdb.Publish(context.Background(), groupRenameTopic(rdb.Options().DB), payload).Err(); err != nil {
		common.SysError(common.LogText("failed to publish group rename notice: %v", err))
	}
}

// StartGroupRenameSubscriber 订阅改名通知。收到比本节点更新的版本时重新加载配置和渠道缓存，
// 然后调用 loaded（上报本节点已加载的版本）。
func StartGroupRenameSubscriber(ctx context.Context, loaded func()) {
	rdb := common.RDB
	if !common.RedisEnabled || rdb == nil {
		return
	}
	groupRenameSubscriber.Do(func() {
		go func() {
			pubsub := rdb.Subscribe(ctx, groupRenameTopic(rdb.Options().DB))
			defer pubsub.Close()
			messages := pubsub.Channel()
			for {
				select {
				case <-ctx.Done():
					return
				case message, ok := <-messages:
					if !ok {
						return
					}
					origin, raw, found := strings.Cut(message.Payload, ":")
					revision, err := strconv.ParseInt(raw, 10, 64)
					if !found || err != nil || origin == groupRenameNotifyOrigin {
						continue
					}
					go reloadForGroupRename(revision, loaded)
				}
			}
		}()
	})
}

// reloadForGroupRename 加载通知里的改名版本。迁移会改分组配置和能力表，所以整份配置和渠道缓存一起重载。
func reloadForGroupRename(revision int64, loaded func()) {
	groupRenameReloadMu.Lock()
	defer groupRenameReloadMu.Unlock()
	if common.GroupRenameAliasRevision() >= revision {
		return
	}
	loadOptionsFromDatabase()
	InitChannelCache()
	if loaded != nil {
		loaded()
	}
}
