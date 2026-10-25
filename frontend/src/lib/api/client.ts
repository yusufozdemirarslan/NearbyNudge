import type { ApiErrorBody } from "./types"

/**
 * An error returned by the NearbyNudge API (any non-2xx response), or a
 * network failure (`status` 0, `code` "network").
 *
 * `message` is always a plain-language sentence that is safe to show users.
 * `fields` carries per-field messages for form errors (`code` "validation").
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

/** True when `error` is an ApiError, optionally with a given code. */
export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code)
}

/** True when a fetch was cancelled through an AbortSignal. */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

const NETWORK_MESSAGE =
  "We couldn't reach NearbyNudge. Check your connection and try again."
const GENERIC_MESSAGE = "Something went wrong on our side. Please try again."

/** Reads the double-submit CSRF cookie the server sets (`nn_csrf`). */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === "nn_csrf") return decodeURIComponent(rest.join("="))
  }
  return null
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export interface RequestOptions {
  signal?: AbortSignal
}

async function send(
  method: HttpMethod,
  path: string,
  body: unknown,
  options: RequestOptions,
  accept: string
): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfToken()
    if (token) headers["X-CSRF-Token"] = token
  }

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: options.signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError(0, "network", NETWORK_MESSAGE)
  }

  if (!response.ok) {
    throw await toApiError(response)
  }
  return response
}

async function toApiError(response: Response) {
  let parsed: ApiErrorBody | null = null
  try {
    parsed = (await response.json()) as ApiErrorBody
  } catch {
    parsed = null
  }
  const code = parsed?.error?.code ?? `http_${response.status}`
  const message = parsed?.error?.message ?? GENERIC_MESSAGE
  return new ApiError(response.status, code, message, parsed?.error?.fields)
}

/**
 * Sends a JSON request to our own server and returns the parsed JSON body
 * (or `undefined` for 204 responses). Same-origin only, cookies included,
 * `X-CSRF-Token` added on POST/PUT/PATCH/DELETE. Throws `ApiError`.
 */
export async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const response = await send(method, path, body, options, "application/json")
  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(response.status, "bad_response", GENERIC_MESSAGE)
  }
}

/** Downloads a file (CSV exports) from our server as a Blob. */
export async function requestBlob(path: string, options: RequestOptions = {}) {
  const response = await send("GET", path, undefined, options, "text/csv, */*")
  return response.blob()
}
