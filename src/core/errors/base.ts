/**
 * Base error class for all B.U.T.L.E.R. Alfred domain and infrastructure errors.
 */
export abstract class AlfredError extends Error {
  public abstract readonly code: string;
  public readonly timestamp: Date;

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Safe representation of the error suitable for logging without leaking secrets.
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString()
    };
  }
}
