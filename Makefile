.PHONY: help dev tui test bun-test typecheck check install link

components:
	npx shadcn@latest add http://localhost:4445/all.json

dev:
	@bash -c 'trap "bun lib/index.ts gateway stop >/dev/null 2>&1" EXIT; \
	  bun lib/index.ts gateway stop >/dev/null 2>&1; \
	  FUNNEL_PORT=$${FUNNEL_PORT:-9742} bun --watch lib/gateway/daemon.ts'

tui:
	@bun lib/index.ts

test:
	@bunx vp test run
	@$(MAKE) bun-test

bun-test:
	@bun test $$(find lib -name "*.bun-test.ts" | sed 's|^|./|')

typecheck:
	@bunx tsc -b

check: typecheck test

install:
	@bun install

link:
	@bun link
