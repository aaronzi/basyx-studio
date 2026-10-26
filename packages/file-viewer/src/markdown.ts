import type { MarkdownIt as Markdown, Token } from 'markdown-it'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

// Markdown as HTML for the rendered view. The text comes from the AAS data,
// not from Studio, so nothing in it may run or reach out:
// - raw HTML is not rendered (markdown-it's `html: false` shows it as text),
//   and DOMPurify sanitizes the result once more;
// - only http(s) and mailto links stay links, opening a new tab without a
//   referrer; others (relative, `javascript:`) become text;
// - images load only from `data:` URLs; one at an address becomes a link to
//   it, so no host learns that the file was viewed.
// Typography comes from Vuetify's utility classes, added per element, as
// Studio uses no style sheets of its own.

const classes: Record<string, string> = {
  h1: 'text-headline-medium mt-2 mb-4',
  h2: 'text-headline-small mt-6 mb-3',
  h3: 'text-title-large mt-5 mb-2',
  h4: 'text-title-medium mt-4 mb-2',
  h5: 'text-title-small mt-4 mb-2',
  h6: 'text-title-small mt-4 mb-2 text-medium-emphasis',
  p: 'text-body-medium mb-3',
  ul: 'ps-6 mb-3 text-body-medium',
  ol: 'ps-6 mb-3 text-body-medium',
  blockquote: 'border-s-lg ps-4 mb-3 text-medium-emphasis',
  pre: 'bg-surface-light rounded pa-3 mb-3 text-body-small overflow-x-auto',
  code: 'bg-surface-light rounded px-1',
  hr: 'v-divider my-4',
  a: 'text-primary',
}

const linkable = /^(?:https?:|mailto:)/i

function addClass (token: Token, tag: string) {
  const value = classes[tag]
  if (value) {
    token.attrJoin('class', value)
  }
}

function create (): Markdown {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })
  const rules = markdown.renderer.rules

  markdown.core.ruler.push('studio_classes', state => {
    const links: boolean[] = []
    const walk = (tokens: Token[]) => {
      for (const token of tokens) {
        if (token.nesting !== -1 && token.type !== 'fence' && token.type !== 'code_block') {
          addClass(token, token.type === 'code_inline' ? 'code' : token.tag)
        }
        if (token.type === 'link_open') {
          const keep = linkable.test(String(token.attrGet('href') ?? ''))
          links.push(keep)
          if (keep) {
            token.attrSet('target', '_blank')
            token.attrSet('rel', 'noopener noreferrer')
          } else {
            token.tag = 'span'
            token.attrs = null
          }
        } else if (token.type === 'link_close' && links.pop() === false) {
          token.tag = 'span'
        }
        if (token.children) {
          walk(token.children)
        }
      }
    }
    walk(state.tokens)
  })

  // Code blocks without a highlighter: the language stays unknown to the page.
  rules.fence = (tokens, index) => `<pre class="${classes.pre}"><code>${markdown.utils.escapeHtml(tokens[index]!.content)}</code></pre>`
  rules.code_block = rules.fence

  // Tables in Vuetify's table markup, so they look like v-table.
  rules.table_open = () => '<div class="v-table v-table--density-compact mb-3 border rounded"><div class="v-table__wrapper"><table>'
  rules.table_close = () => '</table></div></div>'

  const image = rules.image!
  rules.image = (tokens, index, options, environment, self) => {
    const token = tokens[index]!
    const source = String(token.attrGet('src') ?? '')
    if (source.startsWith('data:')) {
      return image(tokens, index, options, environment, self)
    }
    const alt = markdown.utils.escapeHtml(token.content || source)
    if (!/^https?:/i.test(source)) {
      return `<span class="text-medium-emphasis"><i class="mdi mdi-image-off-outline"></i> ${alt}</span>`
    }
    return `<a class="text-primary" href="${markdown.utils.escapeHtml(source)}" target="_blank" rel="noopener noreferrer"><i class="mdi mdi-image-outline"></i> ${alt}</a>`
  }
  return markdown
}

let renderer: Markdown | null = null

/** Markdown as HTML before DOMPurify, which needs a DOM (exported for tests). */
export function markdownToHtml (text: string): string {
  renderer ??= create()
  return renderer.render(text)
}

let purifier: ReturnType<typeof DOMPurify> | null = null

/**
 * A DOMPurify of its own, so its hook touches no other sanitizing on the
 * page: DOMPurify drops `target` and `rel`, so every link that survives gets
 * them back, opening in a new tab without referrer or opener.
 */
function sanitizer (): ReturnType<typeof DOMPurify> {
  if (!purifier) {
    purifier = DOMPurify(window)
    purifier.addHook('afterSanitizeAttributes', node => {
      if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }
  return purifier
}

/** Markdown as sanitized HTML with Vuetify's typography classes. */
export function renderMarkdown (text: string): string {
  return sanitizer().sanitize(markdownToHtml(text), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    // Only data: images; links are http(s) or mailto (above).
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);)/i,
  })
}
