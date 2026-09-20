package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server      ServerConfig   `mapstructure:"server"`
	Database    DatabaseConfig `mapstructure:"database"`
	LogDatabase DatabaseConfig `mapstructure:"log_database"`
	Engine      EngineConfig   `mapstructure:"engine"`
	Logging     LoggingConfig  `mapstructure:"logging"`
	Auth        AuthConfig     `mapstructure:"auth"`
	Veridrop    VeridropConfig `mapstructure:"veridrop"`
	Probe       ProbeConfig    `mapstructure:"probe"`
}

// ProbeConfig 渠道探测默认配置。
// 具体探测参数（cron、并发、告警 webhook 等）在控制台页面调整并落库，
// 这里只提供首次运行与重置时的默认值。
type ProbeConfig struct {
	AvailDefaultCron      string `mapstructure:"avail_default_cron"`
	QualityDefaultCron    string `mapstructure:"quality_default_cron"`
	TimeoutSec            int    `mapstructure:"timeout_sec"`
	Concurrency           int    `mapstructure:"concurrency"`
	QualityTimeoutSec     int    `mapstructure:"quality_timeout_sec"`
	QualityScoreThreshold int    `mapstructure:"quality_score_threshold"`
	CooldownSec           int    `mapstructure:"cooldown_sec"`
}

// VeridropConfig 中转站检测服务(veridrop,独立部署的 Python 服务)。
// 控制台通过 /veridrop 反向代理访问它,见 internal/api/handler_veridrop.go。
type VeridropConfig struct {
	Enabled bool `mapstructure:"enabled"`
	// Upstream 是 veridrop 服务地址,例如 http://127.0.0.1:8000。
	// tt-inspector 跑在容器里时,同机服务需要用 host.docker.internal。
	Upstream string `mapstructure:"upstream"`
}

type AuthConfig struct {
	JWTSecret     string `mapstructure:"jwt_secret"`
	AdminPassword string `mapstructure:"admin_password"`
}

type ServerConfig struct {
	Port         int           `mapstructure:"port"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
}

type DatabaseConfig struct {
	Driver       string `mapstructure:"driver"` // mysql 或 postgres，默认 mysql
	DSN          string `mapstructure:"dsn"`
	MaxOpenConns int    `mapstructure:"max_open_conns"`
	MaxIdleConns int    `mapstructure:"max_idle_conns"`
}

type EngineConfig struct {
	PollInterval          time.Duration `mapstructure:"poll_interval"`
	RuleReloadInterval    time.Duration `mapstructure:"rule_reload_interval"`
	ErrorScanPollInterval time.Duration `mapstructure:"error_scan_poll_interval"`
	DefaultWindowSec      int           `mapstructure:"default_window_sec"`
	DefaultCooldownSec    int           `mapstructure:"default_cooldown_sec"`
	CheckpointFile        string        `mapstructure:"checkpoint_file"`
}

type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
}

func Load(path string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(path)
	v.SetConfigType("yaml")

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	// 默认值
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 9200
	}
	if cfg.Database.Driver == "" {
		cfg.Database.Driver = "mysql"
	}
	if cfg.LogDatabase.Driver == "" {
		cfg.LogDatabase.Driver = cfg.Database.Driver
	}
	if cfg.LogDatabase.DSN == "" {
		cfg.LogDatabase.DSN = cfg.Database.DSN
	}
	if cfg.LogDatabase.MaxOpenConns == 0 {
		cfg.LogDatabase.MaxOpenConns = cfg.Database.MaxOpenConns
	}
	if cfg.LogDatabase.MaxIdleConns == 0 {
		cfg.LogDatabase.MaxIdleConns = cfg.Database.MaxIdleConns
	}
	if cfg.Server.ReadTimeout == 0 {
		cfg.Server.ReadTimeout = 30 * time.Second
	}
	if cfg.Server.WriteTimeout == 0 {
		cfg.Server.WriteTimeout = 30 * time.Second
	}
	if cfg.Engine.DefaultWindowSec == 0 {
		cfg.Engine.DefaultWindowSec = 300
	}
	if cfg.Engine.DefaultCooldownSec == 0 {
		cfg.Engine.DefaultCooldownSec = 600
	}
	if cfg.Engine.ErrorScanPollInterval == 0 {
		cfg.Engine.ErrorScanPollInterval = 300 * time.Second
	}
	if cfg.Engine.CheckpointFile == "" {
		cfg.Engine.CheckpointFile = "checkpoint.json"
	}
	if cfg.Auth.JWTSecret == "" {
		cfg.Auth.JWTSecret = "tt-inspector-jwt-secret-change-me"
	}
	if cfg.Auth.AdminPassword == "" {
		cfg.Auth.AdminPassword = "AIGateway@2026!Admin"
	}
	if cfg.Veridrop.Upstream == "" {
		cfg.Veridrop.Upstream = "http://127.0.0.1:8000"
	}
	if cfg.Probe.AvailDefaultCron == "" {
		cfg.Probe.AvailDefaultCron = "0 */6 * * *"
	}
	if cfg.Probe.QualityDefaultCron == "" {
		cfg.Probe.QualityDefaultCron = "0 4 * * *"
	}
	if cfg.Probe.TimeoutSec == 0 {
		cfg.Probe.TimeoutSec = 15
	}
	if cfg.Probe.Concurrency == 0 {
		cfg.Probe.Concurrency = 5
	}
	if cfg.Probe.QualityTimeoutSec == 0 {
		cfg.Probe.QualityTimeoutSec = 300
	}
	if cfg.Probe.QualityScoreThreshold == 0 {
		cfg.Probe.QualityScoreThreshold = 60
	}
	if cfg.Probe.CooldownSec == 0 {
		cfg.Probe.CooldownSec = 1800
	}

	return &cfg, nil
}
