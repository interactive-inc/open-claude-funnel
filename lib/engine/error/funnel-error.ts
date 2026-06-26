/**
 * Base class every typed funnel error extends. Hosts can branch with
 * `instanceof FunnelError` to distinguish library failures from arbitrary
 * thrown values, then narrow to a specific subclass for action-grade
 * matching. The `code` field is the discriminant for serialisation /
 * cross-process boundaries where prototypes do not survive.
 */
export abstract class FunnelError extends Error {
  abstract readonly code: string

  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = new.target.name
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", { value: options.cause, enumerable: false })
    }
  }
}

export class FunnelChannelNotFoundError extends FunnelError {
  readonly code = "channel-not-found"

  constructor(
    readonly channel: string,
    options?: { cause?: unknown },
  ) {
    super(`channel not found: ${channel}`, options)
  }
}

export class FunnelChannelAlreadyExistsError extends FunnelError {
  readonly code = "channel-already-exists"

  constructor(
    readonly channel: string,
    options?: { cause?: unknown },
  ) {
    super(`channel already exists: ${channel}`, options)
  }
}

export class FunnelConnectorNotFoundError extends FunnelError {
  readonly code = "connector-not-found"

  constructor(
    readonly channel: string,
    readonly connector: string,
    options?: { cause?: unknown },
  ) {
    super(`connector not found in ${channel}: ${connector}`, options)
  }
}

export class FunnelConnectorTypeMismatchError extends FunnelError {
  readonly code = "connector-type-mismatch"

  constructor(
    readonly connector: string,
    readonly expected: string,
    readonly actual: string,
    options?: { cause?: unknown },
  ) {
    super(
      `connector ${connector} type mismatch: expected ${expected}, got ${actual}`,
      options,
    )
  }
}

export class FunnelAuthFailedError extends FunnelError {
  readonly code = "auth-failed"

  constructor(
    readonly connector: string,
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${connector}: auth failed — ${detail}`, options)
  }
}

export class FunnelGatewayBindError extends FunnelError {
  readonly code = "gateway-bind"

  constructor(
    readonly host: string,
    readonly port: number,
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`gateway failed to bind ${host}:${port} — ${detail}`, options)
  }
}

export class FunnelTokenCollisionError extends FunnelError {
  readonly code = "token-collision"

  constructor(
    readonly connector: string,
    options?: { cause?: unknown },
  ) {
    super(
      `${connector}: both literal token and tokenEnv reference are set — pick one`,
      options,
    )
  }
}
