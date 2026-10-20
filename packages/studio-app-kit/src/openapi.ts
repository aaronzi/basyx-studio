import type { Finding } from './manifest.ts'
import type { ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020.js'

// The operations of an app connection's OpenAPI document (ADR 0047), in one
// place for `studio-app pack` and `verify`, Studio's upload, and the calls
// Studio sends. Only the operations the manifest lists are indexed; their
// parameters and request bodies are validated with the document's schemas.
// Without Node or browser APIs, so all three can use it.

export const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
export type HttpMethod = Uppercase<(typeof httpMethods)[number]>

/** The largest OpenAPI document an app connection may name. */
export const maxApiDocumentBytes = 4 * 1024 * 1024

/** A JSON pointer as its unescaped segments. */
export type Pointer = readonly string[]

export interface ApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  /** An array schema: the value is a list, sent as repeated query keys or comma-separated. */
  array: boolean
  /** `form` style only: repeated keys (`true`, the default) or one comma-separated value. */
  explode: boolean
  /** Where the parameter's schema is, if it has one. */
  schema: Pointer | null
}

export interface ApiMediaType {
  /** As declared, in lower case, e.g. `application/json` or `multipart/form-data`. */
  mediaType: string
  schema: Pointer | null
}

export interface ApiOperation {
  operationId: string
  method: HttpMethod
  /** The path template, e.g. `/stations/{station}/forecast`. */
  path: string
  summary: string | null
  parameters: ApiParameter[]
  requestBody: { required: boolean, content: ApiMediaType[] } | null
  /** The media types of all declared responses, for `Accept`. */
  responseMediaTypes: string[]
  /** Where the operation is in the document, for findings. */
  pointer: Pointer
}

export interface ApiIndex {
  /** The document, with OpenAPI 3.0 schemas converted to JSON Schema 2020-12. */
  document: Record<string, unknown>
  /** The listed operations by `operationId`. */
  operations: Map<string, ApiOperation>
}

/** How Studio treats a body of a media type (ADR 0047). */
export type BodyKind = 'json' | 'text' | 'form' | 'multipart' | 'bytes'

/** The kind of body a media type carries; parameters such as `charset` are ignored. */
export function bodyKindOf (mediaType: string): BodyKind {
  const type = mediaType.split(';', 1)[0]!.trim().toLowerCase()
  if (type === 'application/json' || /^[\w.+-]+\/[\w.+-]+\+json$/.test(type)) {
    return 'json'
  }
  if (type === 'application/x-www-form-urlencoded') {
    return 'form'
  }
  if (type === 'multipart/form-data') {
    return 'multipart'
  }
  if (type.startsWith('text/') || type === 'application/xml' || type.endsWith('+xml') || type === 'application/yaml' || type === 'application/x-yaml' || type === 'application/x-ndjson') {
    return 'text'
  }
  return 'bytes'
}

/** Headers an operation may not declare as parameters: Studio sets them, or they change how the request is sent. */
export const reservedHeaderParameters: ReadonlySet<string> = new Set([
  'accept',
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'expect',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

type Json = Record<string, unknown>

function isObject (value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeSegment (segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** A pointer as a `#/…` fragment of the document, as findings and `$ref`s write it. */
export function pointerText (pointer: Pointer): string {
  return `#${pointer.map(segment => `/${escapeSegment(segment)}`).join('')}`
}

function parsePointer (ref: string): Pointer | null {
  if (!ref.startsWith('#')) {
    return null
  }
  const fragment = ref.slice(1)
  if (fragment === '') {
    return []
  }
  if (!fragment.startsWith('/')) {
    return null
  }
  try {
    return decodeURIComponent(fragment).slice(1).split('/').map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  } catch {
    return null
  }
}

function at (document: unknown, pointer: Pointer): unknown {
  let current = document
  for (const segment of pointer) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
    } else if (isObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** Follows local `$ref`s from a pointer to the object they end at; `null` when one does not resolve. */
export function resolvePointer (document: unknown, pointer: Pointer): { pointer: Pointer, value: Json } | null {
  let current = pointer
  for (let hops = 0; hops < 32; hops++) {
    const value = at(document, current)
    if (!isObject(value)) {
      return null
    }
    if (typeof value.$ref !== 'string') {
      return { pointer: current, value }
    }
    const next = parsePointer(value.$ref)
    if (!next) {
      return null
    }
    current = next
  }
  return null
}

/**
 * OpenAPI 3.0 schemas as JSON Schema 2020-12: `nullable` becomes a `null`
 * type, boolean `exclusiveMinimum`/`exclusiveMaximum` become numbers. The
 * rest of the document is copied as it is.
 */
function convert30 (value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => convert30(item))
  }
  if (!isObject(value)) {
    return value
  }
  const copy: Json = {}
  for (const [key, child] of Object.entries(value)) {
    copy[key] = convert30(child)
  }
  if (copy.nullable === true) {
    if (typeof copy.type === 'string') {
      copy.type = [copy.type, 'null']
    }
    if (Array.isArray(copy.enum) && !copy.enum.includes(null)) {
      copy.enum = [...copy.enum, null]
    }
  }
  if (typeof copy.nullable === 'boolean') {
    delete copy.nullable
  }
  if (copy.exclusiveMinimum === true && typeof copy.minimum === 'number') {
    copy.exclusiveMinimum = copy.minimum
    delete copy.minimum
  } else if (typeof copy.exclusiveMinimum === 'boolean') {
    delete copy.exclusiveMinimum
  }
  if (copy.exclusiveMaximum === true && typeof copy.maximum === 'number') {
    copy.exclusiveMaximum = copy.maximum
    delete copy.maximum
  } else if (typeof copy.exclusiveMaximum === 'boolean') {
    delete copy.exclusiveMaximum
  }
  return copy
}

/** Every `$ref` of the document that is not local, with where it is. */
function foreignRefs (value: unknown, pointer: string[], found: { pointer: Pointer, ref: string }[]): void {
  if (found.length >= 5) {
    return
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      foreignRefs(item, [...pointer, String(index)], found)
    }
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && !child.startsWith('#')) {
        found.push({ pointer, ref: child })
      } else {
        foreignRefs(child, [...pointer, key], found)
      }
    }
  }
}

function schemaTypes (schema: Json | undefined): string[] {
  if (!schema) {
    return []
  }
  return typeof schema.type === 'string' ? [schema.type] : (Array.isArray(schema.type) ? schema.type.filter((type): type is string => typeof type === 'string') : [])
}

/**
 * Indexes the listed operations of an OpenAPI document (ADR 0047). The
 * findings name the document's path with a pointer into it, or the
 * manifest's operation entry; `file` is the document's package path and
 * `listedAt` where the manifest lists the operations.
 */
export function indexApi (text: string, operationIds: readonly string[], file: string, listedAt: string): { index: ApiIndex | null, findings: Finding[] } {
  const findings: Finding[] = []
  const finding = (pointer: Pointer, message: string) => findings.push({ path: `${file}${pointer.length > 0 ? pointerText(pointer) : ''}`, message })
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { index: null, findings: [{ path: file, message: 'is not valid JSON; an app connection\'s OpenAPI document must be JSON' }] }
  }
  if (!isObject(parsed) || typeof parsed.openapi !== 'string' || !/^3\.[01]\.\d+$/.test(parsed.openapi)) {
    return { index: null, findings: [{ path: file, message: 'is not an OpenAPI 3.0 or 3.1 document (openapi: 3.0.x or 3.1.x)' }] }
  }
  const v30 = parsed.openapi.startsWith('3.0.')
  if (!v30 && parsed.jsonSchemaDialect !== undefined && parsed.jsonSchemaDialect !== 'https://spec.openapis.org/oas/3.1/dialect/base') {
    finding(['jsonSchemaDialect'], 'names a JSON Schema dialect other than OpenAPI 3.1\'s default, which Studio does not validate')
  }
  const refs: { pointer: Pointer, ref: string }[] = []
  foreignRefs(parsed, [], refs)
  for (const { pointer, ref } of refs) {
    finding(pointer, `refers to ${JSON.stringify(ref.slice(0, 200))}; only references within the document (#/…) are supported, so bundle the document first`)
  }
  const document = (v30 ? convert30(parsed) : parsed) as Json
  if (!isObject(document.paths)) {
    return { index: null, findings: [...findings, { path: file, message: 'has no paths' }] }
  }

  const wanted = new Set(operationIds)
  const operations = new Map<string, ApiOperation>()
  for (const [path, rawItem] of Object.entries(document.paths)) {
    const resolvedItem = resolvePointer(document, ['paths', path])
    if (!resolvedItem || !isObject(rawItem)) {
      continue
    }
    const item = resolvedItem.value
    for (const method of httpMethods) {
      const operation = item[method]
      if (!isObject(operation) || typeof operation.operationId !== 'string' || !wanted.has(operation.operationId)) {
        continue
      }
      const pointer: Pointer = [...resolvedItem.pointer, method]
      const { operationId } = operation
      if (operations.has(operationId)) {
        finding(pointer, `has the operationId ${JSON.stringify(operationId)} a second time`)
        continue
      }
      if (!path.startsWith('/')) {
        finding(['paths', path], 'must start with /')
        continue
      }
      operations.set(operationId, indexOperation(document, path, method, item, resolvedItem.pointer, operation, pointer, finding))
    }
  }
  for (const [index, operationId] of operationIds.entries()) {
    if (!operations.has(operationId)) {
      findings.push({ path: `${listedAt}[${index}]`, message: `names ${JSON.stringify(operationId)}, which ${file} does not define` })
    }
  }
  return { index: findings.length > 0 ? null : { document, operations }, findings }
}

type Report = (pointer: Pointer, message: string) => void

/** One parameter object as Studio sends it, or `null` with a finding. */
function indexParameter (document: Json, value: Json, at: Pointer, finding: Report): ApiParameter | null {
  const location = value.in
  const name = typeof value.name === 'string' ? value.name : ''
  if (location !== 'path' && location !== 'query' && location !== 'header') {
    finding(at, `is a ${String(location)} parameter; Studio sends path, query and header parameters only`)
    return null
  }
  if (!name) {
    finding(at, 'has no name')
    return null
  }
  if (location === 'header' && reservedHeaderParameters.has(name.toLowerCase())) {
    finding(at, `declares the header ${name}, which Studio sets itself`)
    return null
  }
  if (value.content !== undefined) {
    finding(at, 'describes its value with content; Studio supports parameters with a schema')
    return null
  }
  const defaultStyle = location === 'query' ? 'form' : 'simple'
  const style = value.style ?? defaultStyle
  if (style !== defaultStyle) {
    finding(at, `uses style ${String(style)}; Studio sends ${location} parameters in the ${defaultStyle} style`)
    return null
  }
  const schema = isObject(value.schema) ? resolvePointer(document, [...at, 'schema']) : null
  const types = schemaTypes(schema?.value)
  if (types.includes('object')) {
    finding(at, 'is an object; Studio sends parameters with primitive values or arrays of them')
    return null
  }
  const array = types.includes('array')
  const items = array && schema && isObject(schema.value.items) ? resolvePointer(document, [...schema.pointer, 'items'])?.value : undefined
  const itemTypes = schemaTypes(items)
  if (itemTypes.includes('object') || itemTypes.includes('array')) {
    finding(at, 'is an array of objects or arrays; Studio sends arrays of primitive values only')
    return null
  }
  return {
    name,
    in: location,
    required: location === 'path' || value.required === true,
    array,
    explode: typeof value.explode === 'boolean' ? value.explode : style === 'form',
    schema: isObject(value.schema) ? [...at, 'schema'] : null,
  }
}

/** The parameters of an operation: those of its path, overridden by its own of the same name and location. */
function indexParameters (document: Json, path: string, owners: readonly (readonly [Json, Pointer])[], pointer: Pointer, finding: Report): ApiParameter[] {
  const byKey = new Map<string, { value: Json, pointer: Pointer }>()
  for (const [owner, ownerPointer] of owners) {
    if (!Array.isArray(owner.parameters)) {
      continue
    }
    for (const index of owner.parameters.keys()) {
      const resolved = resolvePointer(document, [...ownerPointer, 'parameters', String(index)])
      if (resolved) {
        byKey.set(`${String(resolved.value.in)}:${String(resolved.value.name)}`, resolved)
      } else {
        finding([...ownerPointer, 'parameters', String(index)], 'is not a parameter object or a reference that resolves to one')
      }
    }
  }
  const parameters = [...byKey.values()].flatMap(({ value, pointer: at }) => indexParameter(document, value, at, finding) ?? [])

  const templated = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!)
  for (const name of templated) {
    if (!parameters.some(parameter => parameter.in === 'path' && parameter.name === name)) {
      finding(pointer, `has {${name}} in its path, but no path parameter of that name`)
    }
  }
  for (const parameter of parameters) {
    if (parameter.in === 'path' && !templated.includes(parameter.name)) {
      finding(pointer, `declares the path parameter ${parameter.name}, which its path does not contain`)
    }
  }
  return parameters
}

function indexRequestBody (document: Json, method: (typeof httpMethods)[number], operation: Json, pointer: Pointer, finding: Report): ApiOperation['requestBody'] {
  if (operation.requestBody === undefined) {
    return null
  }
  if (method === 'get' || method === 'head') {
    finding([...pointer, 'requestBody'], `belongs to a ${method.toUpperCase()} operation; Studio sends no body with ${method.toUpperCase()}`)
    return null
  }
  const resolved = resolvePointer(document, [...pointer, 'requestBody'])
  if (!resolved || !isObject(resolved.value.content)) {
    finding([...pointer, 'requestBody'], 'is not a request body with content')
    return null
  }
  const content = Object.entries(resolved.value.content).map(([mediaType, media]) => ({
    mediaType: mediaType.toLowerCase(),
    schema: isObject(media) && isObject(media.schema) ? [...resolved.pointer, 'content', mediaType, 'schema'] : null,
  }))
  if (content.length === 0) {
    finding([...pointer, 'requestBody', 'content'], 'declares no media type')
  }
  return { required: resolved.value.required === true, content }
}

function responseMediaTypesOf (document: Json, operation: Json, pointer: Pointer): string[] {
  const mediaTypes = new Set<string>()
  for (const status of isObject(operation.responses) ? Object.keys(operation.responses) : []) {
    const response = resolvePointer(document, [...pointer, 'responses', status])
    for (const mediaType of response && isObject(response.value.content) ? Object.keys(response.value.content) : []) {
      mediaTypes.add(mediaType.toLowerCase())
    }
  }
  return [...mediaTypes]
}

function indexOperation (
  document: Json,
  path: string,
  method: (typeof httpMethods)[number],
  item: Json,
  itemPointer: Pointer,
  operation: Json,
  pointer: Pointer,
  finding: Report,
): ApiOperation {
  return {
    operationId: operation.operationId as string,
    method: method.toUpperCase() as HttpMethod,
    path,
    summary: typeof operation.summary === 'string' ? operation.summary.slice(0, 200) : null,
    parameters: indexParameters(document, path, [[item, itemPointer], [operation, pointer]], pointer, finding),
    requestBody: indexRequestBody(document, method, operation, pointer, finding),
    responseMediaTypes: responseMediaTypesOf(document, operation, pointer),
    pointer,
  }
}

/** The properties of a form or multipart body schema, and which carry files. */
export interface FormSchema {
  properties: Map<string, { pointer: Pointer, file: boolean }>
  required: string[]
  /** `additionalProperties: false`: other names are refused. */
  closed: boolean
}

function isFileSchema (schema: Json | undefined): boolean {
  if (!schema) {
    return false
  }
  if (schema.format === 'binary' || schema.format === 'byte' || typeof schema.contentMediaType === 'string' || typeof schema.contentEncoding === 'string') {
    return true
  }
  return false
}

/** The fields and files of a form or multipart body schema, following references. */
export function formSchemaOf (document: unknown, pointer: Pointer): FormSchema {
  const resolved = resolvePointer(document, pointer)
  const properties = new Map<string, { pointer: Pointer, file: boolean }>()
  if (resolved && isObject(resolved.value.properties)) {
    for (const name of Object.keys(resolved.value.properties)) {
      const property = resolvePointer(document, [...resolved.pointer, 'properties', name])
      const items = property && isObject(property.value.items) ? resolvePointer(document, [...property.pointer, 'items'])?.value : undefined
      properties.set(name, { pointer: [...resolved.pointer, 'properties', name], file: isFileSchema(property?.value) || isFileSchema(items) })
    }
  }
  return {
    properties,
    required: Array.isArray(resolved?.value.required) ? resolved.value.required.filter((name): name is string => typeof name === 'string') : [],
    closed: resolved?.value.additionalProperties === false,
  }
}

/**
 * The compiled schemas of an operation: per parameter (`in:name`), per JSON
 * request media type, per form field. Parameter and field validators take
 * `{ value }` and coerce `value` in place to the schema's type.
 */
export interface OperationValidators {
  parameters: Map<string, ValidateFunction>
  bodies: Map<string, ValidateFunction>
  forms: Map<string, { schema: FormSchema, fields: Map<string, ValidateFunction> }>
}

const documentId = 'urn:basyx:studio:openapi'

function refTo (pointer: Pointer): { $ref: string } {
  return { $ref: `${documentId}#${pointer.map(segment => `/${encodeURIComponent(escapeSegment(segment))}`).join('')}` }
}

/** Formats of OpenAPI that JSON Schema does not define; they are annotations. */
const openApiFormats = ['binary', 'byte', 'int32', 'int64', 'float', 'double', 'password']

function apiAjv (document: Json, coerce: boolean): Ajv2020 {
  // Not strict: OpenAPI schemas carry keywords such as `example`, `xml` or
  // `discriminator`, which are annotations here.
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false, validateSchema: false, coerceTypes: coerce ? 'array' : false })
  addFormats(ajv)
  for (const format of openApiFormats) {
    if (!ajv.formats[format]) {
      ajv.addFormat(format, true)
    }
  }
  ajv.addSchema(document, documentId)
  return ajv
}

/**
 * Compiles the schemas of the indexed operations. Parameters and form
 * fields are coerced from strings to their schema's type; JSON bodies are
 * validated as given. The findings name schemas that do not compile.
 */
export function compileApi (index: ApiIndex, file: string): { validators: Map<string, OperationValidators>, findings: Finding[] } {
  const strict = apiAjv(index.document, false)
  const coercing = apiAjv(index.document, true)
  const findings: Finding[] = []
  const validators = new Map<string, OperationValidators>()
  const compile = (ajv: Ajv2020, pointer: Pointer): ValidateFunction | null => {
    try {
      // Coercion needs a structure to put the coerced value in, so values are wrapped.
      return ajv.compile(ajv === coercing ? { type: 'object', properties: { value: refTo(pointer) } } : refTo(pointer))
    } catch (error) {
      findings.push({ path: `${file}${pointerText(pointer)}`, message: `is not a schema Studio can validate with: ${error instanceof Error ? error.message : String(error)}` })
      return null
    }
  }
  for (const operation of index.operations.values()) {
    const compiled: OperationValidators = { parameters: new Map(), bodies: new Map(), forms: new Map() }
    for (const parameter of operation.parameters) {
      const validate = parameter.schema && compile(coercing, parameter.schema)
      if (validate) {
        compiled.parameters.set(`${parameter.in}:${parameter.name}`, validate)
      }
    }
    for (const media of operation.requestBody?.content ?? []) {
      if (!media.schema) {
        continue
      }
      const kind = bodyKindOf(media.mediaType)
      if (kind === 'json') {
        const validate = compile(strict, media.schema)
        if (validate) {
          compiled.bodies.set(media.mediaType, validate)
        }
      } else if (kind === 'form' || kind === 'multipart') {
        const schema = formSchemaOf(index.document, media.schema)
        const fields = new Map<string, ValidateFunction>()
        for (const [name, property] of schema.properties) {
          const validate = property.file ? null : compile(coercing, property.pointer)
          if (validate) {
            fields.set(name, validate)
          }
        }
        compiled.forms.set(media.mediaType, { schema, fields })
      }
    }
    validators.set(operation.operationId, compiled)
  }
  return { validators, findings }
}
