package api

import (
	"tt-inspector/internal/config"
	"tt-inspector/internal/engine"
	"tt-inspector/internal/store"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func RegisterRoutes(r *gin.Engine, ruleStore *store.RuleStore, channelStore *store.ChannelStore, alertEngine *engine.Engine, logger *zap.Logger, authCfg config.AuthConfig) {
	ruleHandler := &RuleHandler{
		store:  ruleStore,
		engine: alertEngine,
		logger: logger,
	}

	channelHandler := &ChannelHandler{
		store: channelStore,
	}

	// 登录接口（无需认证）
	r.POST("/api/v1/login", LoginHandler(authCfg.JWTSecret, authCfg.AdminPassword))

	// 需要认证的 API
	api := r.Group("/api/v1")
	api.Use(AuthMiddleware(authCfg.JWTSecret))
	{
		api.GET("/check-auth", CheckAuthHandler())

		api.GET("/rules", ruleHandler.List)
		api.POST("/rules", ruleHandler.Create)
		api.GET("/rules/:id", ruleHandler.Get)
		api.PUT("/rules/:id", ruleHandler.Update)
		api.DELETE("/rules/:id", ruleHandler.Delete)
		api.POST("/rules/:id/enable", ruleHandler.Enable)
		api.POST("/rules/:id/disable", ruleHandler.Disable)

		api.POST("/rules/test-match", ruleHandler.TestMatch)

		api.GET("/channels", channelHandler.ListChannels)
		api.GET("/channels/with-models", channelHandler.ListChannelsWithModels)
	}
}
