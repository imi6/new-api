package service

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const (
	// partnerSubmitIpRetention is how long the IP of a supplier submission is
	// kept. The visitor limit only looks back one hour, so clearing an old IP
	// never lets a visitor submit more.
	partnerSubmitIpRetention     = 90 * 24 * time.Hour
	partnerSubmitIpCleanInterval = 24 * time.Hour
)

// StartPartnerSubmitIpCleanup empties the submit IP of supplier submissions
// older than the retention, once at start and then daily. Only the master
// instance does it.
func StartPartnerSubmitIpCleanup() {
	if !common.IsMasterNode {
		return
	}
	go func() {
		ticker := time.NewTicker(partnerSubmitIpCleanInterval)
		defer ticker.Stop()
		for {
			before := time.Now().Add(-partnerSubmitIpRetention).Unix()
			if _, err := model.ClearPartnerSubmitIpsBefore(before); err != nil {
				common.SysError(common.LogText("failed to clear old supplier submission IPs: %s", err.Error()))
			}
			<-ticker.C
		}
	}()
}
