.PHONY: build test typecheck check

build:
	@bunx --no-install vp pack

test:
	@bun test

typecheck:
	@bunx --no-install tsgo --noEmit

check: typecheck test
