.PHONY: help dev tui test typecheck check install link build build-lib build-bin schema clean

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
	@bun test

typecheck:
	@bunx tsc -b

check: typecheck test

install:
	@bun install

link:
	@bun link
