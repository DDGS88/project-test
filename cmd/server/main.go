package main

import (
	"flag"
	"log"

	"tt-inspector/internal/config"
	"tt-inspector/internal/server"
)

func main() {
	configPath := flag.String("config", "config/config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	if err := server.Run(cfg); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
