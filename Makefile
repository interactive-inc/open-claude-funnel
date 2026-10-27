.PHONY: build test typecheck check

build:
	@bunx --no-install vp pack

test:
	@bun test

typecheck:
	@bunx --no-install tsc -b

check: typecheck test
