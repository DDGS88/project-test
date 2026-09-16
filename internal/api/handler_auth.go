package api

import (
	"net/http"

	"tt-inspector/internal/auth"

	"github.com/gin-gonic/gin"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func LoginHandler(jwtSecret, adminPassword string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if req.Username != "admin" || !auth.CheckPassword(req.Password, adminPassword) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
		token, err := auth.GenerateToken(jwtSecret, req.Username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
			return
		}
		// 同时下发 HttpOnly Cookie：内嵌的 veridrop 页面(iframe)拿不到
		// localStorage 里的 token，只能靠 Cookie 通过 /veridrop 的鉴权。
		c.SetCookie(AuthCookieName, token, int(auth.TokenExpiry.Seconds()), "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"token": token}})
	}
}

// CheckAuth 检查是否已登录（用于前端判断）
func CheckAuthHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"authenticated": true, "username": c.GetString("username")}})
	}
}
