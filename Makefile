.PHONY: help dev tui test bun-test typecheck check install link build build-lib build-bin schema clean

components:
	npx shadcn@latest add http://localhost:4445/all.json

build: build-lib build-bin schema

schema:
	@mkdir -p public
	@bun lib/bin.ts schema > funnel.schema.json
	@cp funnel.schema.json public/schema.json

build-lib:
	@bunx vp pack

build-bin:
	@bun build lib/bin.ts lib/gateway/daemon.ts --target=bun --outdir dist --minify

clean:
	@rm -rf dist

dev:
	@bash -c 'trap "bun lib/index.ts gateway stop >/dev/null 2>&1" EXIT; \
	  bun lib/index.ts gateway stop >/dev/null 2>&1; \
	  FUNNEL_PORT=$${FUNNEL_PORT:-9742} bun --watch lib/gateway/daemon.ts'

tui:
	@bun lib/index.ts

test:
	@bunx vp test run
	@$(MAKE) bun-test

# Tests that need Bun-runtime APIs (Bun.serve, bun:sqlite) at runtime.
# Vitest's Node workers cannot run them; bun test executes them natively.
# Keep this list in sync with vite.config.ts `test.exclude`.
bun-test:
	@bun test \
		./lib/cli/dispatch-claude.test.ts \
		./lib/funnel.test.ts \
		./lib/gateway/gateway-server.test.ts \
		./lib/gateway/funnel-event-store.test.ts \
		./lib/logger/leuco-logger-sqlite-sink.test.ts

typecheck:
	@bunx tsc -b

check: typecheck test

install:
	@bun install

link:
	@bun link
