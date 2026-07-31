package api

import (
	"net/http"

	"tt-inspector/internal/store"

	"github.com/gin-gonic/gin"
)

type ChannelHandler struct {
	store *store.ChannelStore
}

func (h *ChannelHandler) ListChannels(c *gin.Context) {
	channels, err := h.store.ListChannels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if channels == nil {
		channels = []store.ChannelOption{}
	}
	c.JSON(http.StatusOK, gin.H{"data": channels})
}

func (h *ChannelHandler) ListChannelsWithModels(c *gin.Context) {
	channels, err := h.store.ListChannelsWithModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": channels})
}
