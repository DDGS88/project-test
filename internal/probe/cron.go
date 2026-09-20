package probe

import (
	"fmt"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

// 标准 5 字段 cron 解析器：分 时 日 月 周
//
// 只开放 5 字段是刻意的：探测任务是分钟级粒度，带上秒字段反而容易
// 让用户误以为可以做到秒级高频探测。
var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

// ParseCron 解析标准 5 字段 cron 表达式
func ParseCron(expr string) (cron.Schedule, error) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return nil, fmt.Errorf("cron 表达式不能为空")
	}
	schedule, err := cronParser.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("cron 表达式非法（需要 5 字段：分 时 日 月 周）: %w", err)
	}
	return schedule, nil
}

// NextRun 计算表达式在 from 之后的下一次运行时间
func NextRun(expr string, from time.Time) (time.Time, error) {
	schedule, err := ParseCron(expr)
	if err != nil {
		return time.Time{}, err
	}
	return schedule.Next(from), nil
}

// ValidateCron 校验表达式并返回下次运行时间（API 用）
func ValidateCron(expr string, from time.Time) (time.Time, error) {
	return NextRun(expr, from)
}
