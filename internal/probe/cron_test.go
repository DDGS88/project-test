package probe

import (
	"testing"
	"time"
)

func TestParseCronValid(t *testing.T) {
	exprs := []string{
		"0 */6 * * *",
		"*/5 * * * *",
		"0 4 * * *",
		"30 1,13 * * 1-5",
		"0 0 1 1 *",
	}
	for _, expr := range exprs {
		if _, err := ParseCron(expr); err != nil {
			t.Errorf("ParseCron(%q) 期望成功，实际报错: %v", expr, err)
		}
	}
}

func TestParseCronInvalid(t *testing.T) {
	exprs := []string{
		"",
		"*/6 * *",
		"61 * * * *",
		"not a cron",
	}
	for _, expr := range exprs {
		if _, err := ParseCron(expr); err == nil {
			t.Errorf("ParseCron(%q) 期望失败，实际通过", expr)
		}
	}
}

func TestNextRun(t *testing.T) {
	from := time.Date(2026, 9, 20, 10, 30, 0, 0, time.Local)

	next, err := NextRun("0 */6 * * *", from)
	if err != nil {
		t.Fatalf("NextRun 报错: %v", err)
	}
	want := time.Date(2026, 9, 20, 12, 0, 0, 0, time.Local)
	if !next.Equal(want) {
		t.Errorf("NextRun(*/6) = %v, 期望 %v", next, want)
	}

	next, err = NextRun("*/5 * * * *", from)
	if err != nil {
		t.Fatalf("NextRun 报错: %v", err)
	}
	want = time.Date(2026, 9, 20, 10, 35, 0, 0, time.Local)
	if !next.Equal(want) {
		t.Errorf("NextRun(*/5) = %v, 期望 %v", next, want)
	}
}
