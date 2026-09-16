package api

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"tt-inspector/internal/auth"
	"tt-inspector/internal/config"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// VeridropPath 是 veridrop 检测服务在控制台里的挂载前缀。
// veridrop 侧需要设置 VERIDROP_PREFIX=/veridrop,页面里的链接才会带上这个前缀。
const VeridropPath = "/veridrop"

// AuthCookieName 是登录后下发的 HttpOnly Cookie。
// 内嵌 iframe 里的请求不会带 Authorization 头(fetch 是 veridrop 自己的代码,
// 不受控制台前端控制),所以 /veridrop 这一组路由用 Cookie 做鉴权。
const AuthCookieName = "tt_inspector_token"

// RegisterVeridropRoutes 把 /veridrop/* 反向代理到独立部署的 veridrop 服务。
//
// 设计:tt-inspector 只管转发和自己那一层鉴权,检测逻辑、报告、历史记录都留在
// veridrop 内部(它自己把报告落盘),这样两边解耦 —— veridrop 升级不会影响
// 控制台,控制台也不需要跟着改。
func RegisterVeridropRoutes(r *gin.Engine, cfg config.VeridropConfig, jwtSecret string, logger *zap.Logger) error {
	proxy, err := newVeridropProxy(cfg.Upstream, logger)
	if err != nil {
		return err
	}

	// 只注册通配路由 —— gin 默认开启 RedirectTrailingSlash,访问 /veridrop
	// 会自动 301 到 /veridrop/(少了尾斜杠页面里的相对路径会解析到上一层)。
	group := r.Group(VeridropPath, VeridropAuthMiddleware(jwtSecret))
	group.Any("/*path", func(c *gin.Context) {
		proxy.ServeHTTP(c.Writer, c.Request)
	})

	logger.Info("veridrop proxy enabled", zap.String("path", VeridropPath), zap.String("upstream", cfg.Upstream))
	return nil
}

func newVeridropProxy(upstream string, logger *zap.Logger) (*httputil.ReverseProxy, error) {
	target, err := url.Parse(upstream)
	if err != nil {
		return nil, fmt.Errorf("parse veridrop upstream %q: %w", upstream, err)
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("veridrop upstream must be an absolute URL, got %q", upstream)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		// 先让默认 director 处理 scheme/host/query 合并,再剥掉挂载前缀 ——
		// veridrop 自己监听在根路径上,只有渲染出来的链接带前缀。
		originalDirector(req)
		req.URL.Path = strings.TrimPrefix(req.URL.Path, VeridropPath)
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		req.URL.RawPath = ""
		req.Host = target.Host
		// X-Forwarded-For / X-Forwarded-Host 由 ReverseProxy 自动追加,veridrop
		// 侧用 X-Forwarded-For 取真实客户端 IP 做按 IP 限速。
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		logger.Warn("veridrop upstream unreachable", zap.String("upstream", upstream), zap.Error(err))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>中转站检测服务不可用</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:48px;color:#191c1e;line-height:1.7}
code{background:#f2f4f6;padding:2px 6px;border-radius:4px}</style></head><body>
<h2>无法连接到 veridrop 检测服务</h2>
<p>上游地址:<code>%s</code></p>
<p>请确认 veridrop 服务已在同机启动(默认 <code>127.0.0.1:8000</code>),且启动时设置了
<code>VERIDROP_PREFIX=/veridrop</code>。</p>
<p style="color:#737686">错误:<code>%s</code></p>
</body></html>`, upstream, err.Error())
	}

	return proxy, nil
}

// VeridropAuthMiddleware 校验 /veridrop 这一组的访问权限。
//
// 与 AuthMiddleware 的区别:内嵌页面里的请求来自 veridrop 自己的 JS 和浏览器
// 导航,拿不到控制台 localStorage 里的 token,所以这里额外接受登录时下发的
// HttpOnly Cookie;两者都没有时直接把页面踢回控制台首页去登录,而不是返回
// 一坨 401 JSON。
func VeridropAuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr, _ := c.Cookie(AuthCookieName)
		if tokenStr == "" {
			tokenStr = strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		}
		if tokenStr == "" {
			c.Redirect(http.StatusFound, "/")
			c.Abort()
			return
		}
		claims, err := auth.ValidateToken(tokenStr, secret)
		if err != nil {
			c.Redirect(http.StatusFound, "/")
			c.Abort()
			return
		}
		c.Set("username", claims.Username)
		c.Next()
	}
}
