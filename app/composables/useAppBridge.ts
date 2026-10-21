import type { AppCallResult, AppContext, AppContributionInfo, AppMethodName, ConnectionCallWireResult, ElementDetail, EmbeddedView, OpenedView, Problem } from '#shared/contract'
import type { Ref } from 'vue'
import { useQueryCache } from '@pinia/colada'
import { appHelloSchema, appMethodNameSchema, appMethodParamsSchemas, appProtocol, appRequestMessageSchema, decodeConnectionResult, embeddedViewSchema, encodeConnectionCall, externalFileUrl, openedViewSchema, readFileMaxBytes, studioAppWriteMethods } from '#shared/contract'
import { StudioApiError } from '~/composables/useStudioApi'
import { resourceKey } from '~/utils/aas'

export interface AppBridgeOptions {
  contribution: () => AppContributionInfo
  /** The target the frame is bound to; fixed for the frame's lifetime. */
  targetId: string | null
  context: () => AppContext
  /** Changes the module's sub-path; `push` adds a history entry, so back returns to the previous one. */
  onNavigate: (subPath: string, history: 'push' | 'replace') => void
  /**
   * Opens the frame's view in a full-screen dialog with the view's state,
   * with or without Studio's header; absent where no further dialog opens.
   */
  onOpenFullscreen?: (state: string, header: boolean) => void
  /** Closes the full-screen dialog the frame runs in; absent outside one. */
  onCloseFullscreen?: () => void
  /**
   * Shows another app's view in a full-screen dialog over the frame
   * (`studio.ui.openView`, ADR 0051); absent in dialogs, which open no
   * further view. A view embedded in the frame's page opens itself there
   * (`studio.ui.openFullscreen`), with its state.
   */
  onOpenView?: (view: OpenedView, state?: string) => void
}

/** A refusal of the host itself, in the shape of Studio's problems. */
function hostProblem (code: Problem['code'], title: string, status: number): StudioApiError {
  return new StudioApiError({ type: 'about:blank', title, status, code, requestId: '', retryable: false })
}

/**
 * Methods that act outside the app's frame and so need a click or key press
 * in it just before: `openShell` leaves the app's page, and `openView`
 * covers it with another app's view, which only the user should decide, not
 * a timer or a page load.
 */
const activationMethods = new Set<AppMethodName>(['studio.ui.copyText', 'studio.ui.openExternal', 'studio.ui.openShell', 'studio.ui.openView'])

/**
 * What a view embedded in an app's page may not do (ADR 0051): the app
 * around it decides where it is and what lies over it, so it could steer
 * clicks into it. It is read-only, and nothing it does acts outside it.
 */
const embeddedRefused = new Set<AppMethodName>([
  ...activationMethods,
  ...studioAppWriteMethods,
  'studio.ui.openFile',
  'studio.ui.navigate',
  'studio.ui.openTarget',
  'studio.ui.embedView',
])

/**
 * A connection to a document: the frame's own, or a view that the frame's
 * app embedded in its page (`studio.ui.embedView`, ADR 0051).
 */
interface Channel {
  port: MessagePort
  contribution: AppContributionInfo
  /** The package the connected document was loaded from; its calls carry it (ADR 0044). */
  digest: string | null
  context: () => AppContext
  /** The embedded view, or `null` for the frame's own document. */
  embedded: EmbeddedView | null
  /** The context last sent, to send only changes. */
  lastContext: string
}

/** Whether a window is a frame somewhere below another one. */
function isInside (source: Window, ancestor: Window): boolean {
  let current = source
  for (let depth = 0; depth < 16 && current !== current.parent; depth++) {
    current = current.parent
    if (current === ancestor) {
      return true
    }
  }
  return false
}

function problemOf (error: unknown): Problem {
  if (error instanceof StudioApiError && error.problem) {
    return error.problem
  }
  return { type: 'about:blank', title: 'Studio could not be reached.', status: 0, code: 'internal_error', requestId: '', retryable: true }
}

/**
 * The host side of the `studio-sdk/0` bridge (ADR 0018). It answers only the
 * frame it created, hands that frame one MessagePort per load of its entry,
 * validates every request, and forwards capability calls to Studio, which
 * checks them against the installed manifest and the user's rights. A frame
 * that navigates away from its entry loses its port and is reloaded. Views
 * that the frame's app embedded get ports of their own, read-only, which
 * never pass through the app (ADR 0051).
 */
export function useAppBridge (frame: Ref<HTMLIFrameElement | null>, options: AppBridgeOptions) {
  const api = useStudioApi()
  const queryCache = useQueryCache()
  const notifications = useNotificationsStore()
  const label = useLocalizedLabel()
  const copy = useClipboard()
  const desktop = useDesktopBridge()
  const studioUrl = useStudioUrl()
  const readExternalFile = useExternalFile()
  const connected = ref(false)
  /** Content height the app asked for (`studio.ui.setHeight`), or `null`. */
  const height = ref<number | null>(null)

  let main: Channel | null = null
  /** Views the frame's app embedded, by their embed token. */
  const embeds = new Map<string, { view: EmbeddedView, channel: Channel | null }>()
  let handedOut = false
  let loads = 0
  let reloading = false

  function openChannel (contribution: AppContributionInfo, digest: string | null, context: () => AppContext, embedded: EmbeddedView | null): { channel: Channel, remote: MessagePort } {
    const { port1, port2 } = new MessageChannel()
    const channel: Channel = { port: port1, contribution, digest, context, embedded, lastContext: JSON.stringify(context()) }
    port1.addEventListener('message', event => void onRequest(channel, event))
    port1.start()
    return { channel, remote: port2 }
  }

  /** The context of an embedded view: the frame's target, theme and language, its own submodel, and always `view` mode. */
  function embeddedContext (embedded: EmbeddedView): AppContext {
    const { view, submodel, shellId } = embedded
    return {
      ...options.context(),
      installationId: view.installationId,
      appId: view.appId,
      contribution: { kind: 'submodelView', id: view.id },
      shell: shellId ? { id: shellId } : null,
      submodel: { id: submodel.id, semanticId: submodel.semanticId },
      subPath: '',
      mode: 'view',
      fullscreen: false,
      fullscreenOpen: false,
      viewState: '',
      embedded: true,
    }
  }

  async function onRequest (channel: Channel, event: MessageEvent) {
    const respond = (message: unknown, transfer: Transferable[] = []) => channel.port.postMessage(message, transfer)
    const parsed = appRequestMessageSchema.safeParse(event.data)
    if (!parsed.success) {
      return
    }
    const { id, method: name, params } = parsed.data
    const method = appMethodNameSchema.safeParse(name)
    if (!method.success) {
      respond({ type: 'error', id, problem: { ...problemOf(null), title: `Unknown method ${name}.`, code: 'invalid_request', status: 400, retryable: false } })
      return
    }
    if (method.data === 'studio.ui.getContext') {
      respond({ type: 'response', id, result: channel.context() })
      return
    }
    if (channel.embedded) {
      const answered = answerEmbedded(channel.embedded, method.data, params)
      if (answered) {
        respond(answered.problem ? { type: 'error', id, problem: answered.problem } : { type: 'response', id, result: null })
        return
      }
    }
    if (method.data === 'studio.ui.setHeight') {
      // Only sizes the app's own frame; needs no permission or round trip.
      const parsedHeight = appMethodParamsSchemas['studio.ui.setHeight'].safeParse(params)
      if (parsedHeight.success) {
        height.value = parsedHeight.data.height
      }
      respond({ type: 'response', id, result: null })
      return
    }
    if (method.data === 'studio.ui.openFullscreen') {
      // Like setHeight, it only affects how Studio shows the app's own view.
      const parsedFullscreen = appMethodParamsSchemas['studio.ui.openFullscreen'].safeParse(params ?? {})
      if (parsedFullscreen.success) {
        options.onOpenFullscreen?.(parsedFullscreen.data.state ?? '', parsedFullscreen.data.header)
      }
      respond({ type: 'response', id, result: null })
      return
    }
    if (method.data === 'studio.ui.closeFullscreen') {
      options.onCloseFullscreen?.()
      respond({ type: 'response', id, result: null })
      return
    }
    // A click in the frame also activates Studio's page (user activation
    // propagates to ancestor frames); read it before the round trip.
    const activated = navigator.userActivation?.isActive ?? true
    const { contribution } = channel
    try {
      if (activationMethods.has(method.data) && !activated) {
        throw hostProblem('forbidden', 'Call this from a click or key press in the app.', 403)
      }
      if (method.data === 'studio.ui.openView' && !options.onOpenView) {
        throw hostProblem('unsupported_operation', 'Views of other apps open only from a frame on Studio\'s page, not from a dialog.', 422)
      }
      const context = channel.context()
      // Connection calls carry bytes, which travel as base64 over HTTP (ADR 0047).
      const connectionCall = method.data === 'studio.connections.call'
      const { result } = method.data === 'studio.aas.putAttachment'
        ? await putAttachment(params, channel)
        : await api<AppCallResult>('/app-calls', {
            method: 'POST',
            // Studio's mode goes with every call: its server refuses structural writes outside edit mode (MVP-7 A1).
            body: { installationId: contribution.installationId, digest: channel.digest ?? undefined, targetId: options.targetId, shellId: context.shell?.id ?? null, mode: context.mode, method: method.data, params: connectionCall ? encodeConnectionCall(params) : params },
          })
      if (connectionCall) {
        const decoded = decodeConnectionResult(result as ConnectionCallWireResult)
        respond({ type: 'response', id, result: decoded.result }, decoded.transfer)
        return
      }
      const replaced = await carryOut(method.data, params, result, contribution)
      respond({ type: 'response', id, result: replaced ? replaced.result : result }, replaced?.transfer)
    } catch (error) {
      const problem = problemOf(error)
      if (problem.code === 'app_outdated') {
        // The app was updated in place: new contributions reload the frame.
        void queryCache.invalidateQueries({ key: ['app-contributions'] })
      }
      respond({ type: 'error', id, problem })
    }
  }

  /**
   * Sends an attachment the frame handed over (MVP-7 A2): the bytes go to
   * Studio's API as the body, the rest of the call in the query, so the
   * server authorizes and audits it like any other call.
   */
  async function putAttachment (params: unknown, channel: Channel): Promise<AppCallResult> {
    if (!options.targetId) {
      throw hostProblem('invalid_request', 'This app frame is not bound to a target.', 400)
    }
    const parsed = appMethodParamsSchemas['studio.aas.putAttachment'].safeParse(params)
    if (!parsed.success) {
      const violations = parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
      throw new StudioApiError({ type: 'about:blank', title: 'Invalid parameters for studio.aas.putAttachment.', status: 400, code: 'invalid_request', requestId: '', retryable: false, violations })
    }
    const { data, contentType, ...call } = parsed.data
    const context = channel.context()
    return api<AppCallResult>('/app-calls/attachment', {
      method: 'PUT',
      query: {
        ...call,
        installationId: channel.contribution.installationId,
        digest: channel.digest ?? undefined,
        targetId: options.targetId,
        shellId: context.shell?.id ?? undefined,
        mode: context.mode,
      },
      headers: { 'Content-Type': contentType },
      body: new Blob([data as BlobPart], { type: contentType }),
    })
  }

  /**
   * Studio authorized the call; UI methods are carried out here. A returned
   * result replaces Studio's; its `transfer` buffers move to the frame.
   */
  async function carryOut (method: AppMethodName, params: unknown, result: unknown, contribution: AppContributionInfo): Promise<{ result: unknown, transfer?: Transferable[] } | null> {
    switch (method) {
      case 'studio.ui.notify': {
        const notice = appMethodParamsSchemas['studio.ui.notify'].parse(params)
        notifications.notify({ text: `${label(contribution.appTitle)}: ${notice.message}`, color: notice.level })
        break
      }
      case 'studio.ui.openFile': {
        if (options.targetId) {
          const file = appMethodParamsSchemas['studio.ui.openFile'].parse(params)
          const url = studioUrl.api(`/targets/${options.targetId}/submodels/${resourceKey(file.submodelId)}/elements/${resourceKey(file.idShortPath)}/attachment${file.download ? '?download' : ''}`)
          window.open(url, '_blank', 'noopener')
        }
        break
      }
      case 'studio.ui.readFile': {
        // Through Studio's API, so the user's own rights apply as in Studio.
        if (!options.targetId) {
          throw hostProblem('invalid_request', 'This app frame is not bound to a target.', 400)
        }
        const file = appMethodParamsSchemas['studio.ui.readFile'].parse(params)
        const blob = await api<Blob>(`/targets/${options.targetId}/submodels/${resourceKey(file.submodelId)}/elements/${resourceKey(file.idShortPath)}/attachment`, { responseType: 'blob' })
        if (blob.size > readFileMaxBytes) {
          throw hostProblem('unsupported_operation', `The file is larger than ${readFileMaxBytes / 1024 / 1024} MiB.`, 422)
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        return { result: { bytes, contentType: blob.type || 'application/octet-stream' }, transfer: [bytes.buffer] }
      }
      case 'studio.ui.readExternalFile': {
        // The address comes from the element as the user reads it, never from the app.
        if (!options.targetId) {
          throw hostProblem('invalid_request', 'This app frame is not bound to a target.', 400)
        }
        const file = appMethodParamsSchemas['studio.ui.readExternalFile'].parse(params)
        const element = await api<ElementDetail>(`/targets/${options.targetId}/submodels/${resourceKey(file.submodelId)}/elements/${resourceKey(file.idShortPath)}`)
        const url = externalFileUrl(element.value)
        if (!url) {
          throw hostProblem('unsupported_operation', 'The element does not name a file by an http(s) address.', 422)
        }
        const content = await readExternalFile(url, { targetId: options.targetId, submodelKey: resourceKey(file.submodelId), elementKey: resourceKey(file.idShortPath) })
        return { result: content, transfer: [content.bytes.buffer] }
      }
      case 'studio.ui.navigate': {
        if (contribution.kind === 'module') {
          const { subPath, history } = appMethodParamsSchemas['studio.ui.navigate'].parse(params)
          options.onNavigate(subPath, history)
        }
        break
      }
      case 'studio.ui.openTarget': {
        await navigateTo(`/targets/${encodeURIComponent(appMethodParamsSchemas['studio.ui.openTarget'].parse(params).targetId)}`)
        break
      }
      case 'studio.ui.openShell': {
        // Studio checked that the user can read the shell. The selected
        // submodel opens in its view, or in its details without one. Not
        // awaited, so that the app gets its answer before the page leaves it.
        if (options.targetId) {
          const { shellId, submodelId } = appMethodParamsSchemas['studio.ui.openShell'].parse(params)
          void navigateTo({
            path: `/targets/${encodeURIComponent(options.targetId)}/shells/${resourceKey(shellId)}`,
            query: submodelId === undefined ? {} : { submodel: resourceKey(submodelId), mode: 'visualization' },
          })
        }
        break
      }
      case 'studio.ui.openView': {
        // Studio checked the submodel as the user and picked the view; the
        // app learns only that it opened, not which app's view it is.
        options.onOpenView?.(openedViewSchema.parse(result))
        return { result: null }
      }
      case 'studio.ui.embedView': {
        // The app gets the frame URL; the view connects to this page itself
        // with the token in it, never through the app (ADR 0051).
        const embedded = embeddedViewSchema.parse(result)
        embeds.set(embedded.token, { view: embedded, channel: null })
        return { result: { url: embedded.url } }
      }
      case 'studio.ui.openExternal': {
        window.open(appMethodParamsSchemas['studio.ui.openExternal'].parse(params).url, '_blank', 'noopener')
        break
      }
      case 'studio.ui.copyText': {
        // Frames may not use the clipboard themselves.
        await copy(appMethodParamsSchemas['studio.ui.copyText'].parse(params).text)
        break
      }
      case 'studio.containers.pickFiles': {
        // Native dialogs of the BaSyx Docker app (ADR 0033), shown only after Studio authorized the pick.
        if (!desktop?.chooseStackFiles) {
          throw hostProblem('unsupported_operation', 'Choosing files needs the desktop app.', 422)
        }
        const { kind, suggestedName } = appMethodParamsSchemas['studio.containers.pickFiles'].parse(params)
        return { result: { files: await desktop.chooseStackFiles(kind, suggestedName) } }
      }
    }
    if (studioAppWriteMethods.has(method) && options.targetId) {
      // Studio's own views show the change, and a workspace its unsaved state.
      // Structural writes also change trees, lists and references.
      const structural = method !== 'studio.aas.setElementValue' && method !== 'studio.aas.putAttachment'
      void queryCache.invalidateQueries({ key: ['targets', options.targetId], exact: !structural })
      if (!structural) {
        void queryCache.invalidateQueries({ key: ['targets', options.targetId, 'details'] })
      }
    }
    return null
  }

  /**
   * Answers what an embedded view asks of the page itself, and refuses what
   * it may not do (ADR 0051); `null` for calls that go to Studio as usual.
   */
  function answerEmbedded (embedded: EmbeddedView, method: AppMethodName, params: unknown): { problem: Problem | null } | null {
    switch (method) {
      case 'studio.ui.setHeight':
      case 'studio.ui.closeFullscreen': {
        // The app around it sizes the frame; Studio does not tell it the view's height.
        return { problem: null }
      }
      case 'studio.ui.openFullscreen': {
        // In Studio's dialog, which Studio draws, the view runs as usual again.
        const parsed = appMethodParamsSchemas['studio.ui.openFullscreen'].safeParse(params ?? {})
        options.onOpenView?.({ view: embedded.view, submodel: embedded.submodel, shellId: embedded.shellId }, parsed.success ? parsed.data.state : undefined)
        return { problem: null }
      }
    }
    if (embeddedRefused.has(method)) {
      return { problem: problemOf(hostProblem('forbidden', 'A view in another app\'s page is read-only; open it in Studio to do this.', 403)) }
    }
    return null
  }

  function closePort () {
    main?.port.close()
    main = null
    for (const embed of embeds.values()) {
      embed.channel?.port.close()
    }
    embeds.clear()
    connected.value = false
  }

  /**
   * Connects a view that the frame's app embedded (ADR 0051): only with a
   * token this frame was given, from the view's own origin, and from a window
   * inside this frame. The port goes to the view's origin only, so the app
   * around it never holds it. A view that loads again gets a new port.
   */
  function connectEmbedded (token: string, event: MessageEvent, own: Window) {
    const embed = embeds.get(token)
    const source = event.source as Window | null
    if (!embed || !main || !source || source === own || event.origin !== embed.view.view.frameOrigin || !isInside(source, own)) {
      return
    }
    embed.channel?.port.close()
    const { view } = embed
    const { channel, remote } = openChannel(view.view, view.view.digest, () => embeddedContext(view), view)
    embed.channel = channel
    source.postMessage({ protocol: appProtocol, type: 'connect', context: channel.context() }, event.origin, [remote])
  }

  function onMessage (event: MessageEvent) {
    const window = frame.value?.contentWindow
    // The frame's own origin, when the installation has one (ADR 0045);
    // otherwise its origin is opaque and cannot be named.
    const frameOrigin = options.contribution().frameOrigin
    const hello = appHelloSchema.safeParse(event.data)
    if (!window || !hello.success) {
      return
    }
    if (hello.data.embed !== undefined) {
      connectEmbedded(hello.data.embed, event, window)
      return
    }
    // A queued hello from the previous document has the same WindowProxy.
    // Do not give it the next document's port during a forced entry reload.
    if (event.source !== window || handedOut || reloading) {
      return
    }
    if (frameOrigin && event.origin !== frameOrigin) {
      return
    }
    handedOut = true
    const { channel, remote } = openChannel(options.contribution(), options.contribution().digest, options.context, null)
    main = channel
    // An opaque origin cannot be named as target origin; the message goes to
    // this frame's window only. A frame with its own origin gets the port
    // only while it still shows a document of that origin.
    window.postMessage({ protocol: appProtocol, type: 'connect', context: channel.context() }, frameOrigin ?? '*', [remote])
    connected.value = true
  }

  /** Each load of the entry may connect once; any other navigation reloads the entry. */
  function onLoad () {
    loads++
    if (loads === 1 || reloading) {
      reloading = false
      return
    }
    closePort()
    handedOut = false
    reloading = true
    if (frame.value) {
      frame.value.src = options.contribution().entryUrl
    }
  }

  // Sent only when something changed, not on every render of the host page.
  // Embedded views follow the frame's theme, language and target.
  watch(() => options.context(), () => {
    for (const channel of [main, ...[...embeds.values()].map(embed => embed.channel)]) {
      if (!channel) {
        continue
      }
      const context = channel.context()
      const serialized = JSON.stringify(context)
      if (serialized !== channel.lastContext) {
        channel.lastContext = serialized
        channel.port.postMessage({ type: 'context', context })
      }
    }
  }, { deep: true })

  onMounted(() => window.addEventListener('message', onMessage))
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    closePort()
  })

  /** Bind to the frame's `load` event. */
  return { connected, height, onLoad }
}
