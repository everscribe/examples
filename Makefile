BIN := bin/server

.PHONY: build web server run dev-web dev-server clean

# Production: bake the React app into a single Go binary.
build: web server

web:
	cd web && npm install && npm run build

server:
	mkdir -p bin
	go build -o $(BIN) .

run: build
	./$(BIN)

# Development: two processes with hot reload.
# Run `make dev-web` and `make dev-server` in separate terminals.
# Vite serves on :5173 and proxies /api/* to the Go server on :8080.
dev-web:
	cd web && npm run dev

dev-server:
	go run .

clean:
	rm -rf bin web/dist
