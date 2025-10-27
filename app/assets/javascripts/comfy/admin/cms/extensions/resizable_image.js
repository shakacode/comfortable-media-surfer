import { Image } from '@tiptap/extension-image'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'

const MIN_SIZE = 50
const SNAP_THRESHOLD = 10

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getBounds(img, options = {}) {
  const minWidth = toNumber(options.minWidth) || MIN_SIZE
  const optionMax = toNumber(options.maxWidth)
  const container = img.closest('.cms-resizable-image-container')
  const containerWidth = Math.max(
    container?.getBoundingClientRect?.().width || 0,
    container?.parentElement?.getBoundingClientRect?.().width || 0,
  ) || null
  const naturalWidth = img.naturalWidth || toNumber(img.getAttribute('width')) || minWidth

  const potentialMax = [
    optionMax,
    containerWidth,
    naturalWidth,
  ].filter(value => typeof value === 'number' && !Number.isNaN(value) && value > 0)

  const maxWidth = potentialMax.length ? Math.max(...potentialMax, minWidth) : naturalWidth

  return {
    minWidth,
    maxWidth: Math.max(minWidth, maxWidth || minWidth),
  }
}

function applyDimensions(img, width, height) {
  const resolvedWidth = toNumber(width)
  const resolvedHeight = toNumber(height)

  if (resolvedWidth != null) {
    const roundedWidth = Math.max(1, Math.round(resolvedWidth))
    img.style.width = `${roundedWidth}px`
    img.width = roundedWidth
  } else {
    img.style.width = ''
    img.removeAttribute('width')
  }

  if (resolvedHeight != null) {
    const roundedHeight = Math.max(1, Math.round(resolvedHeight))
    img.style.height = `${roundedHeight}px`
    img.height = roundedHeight
  } else {
    img.style.height = ''
    img.removeAttribute('height')
  }
}

function syncImageAttributes(img, attrs) {
  if (attrs.src && img.src !== attrs.src) {
    img.src = attrs.src
  }
  if (attrs.alt != null) {
    img.alt = attrs.alt
  } else {
    img.removeAttribute('alt')
  }
  applyDimensions(img, attrs.width, attrs.height)

  if (attrs.originalWidth) {
    img.dataset.originalWidth = String(attrs.originalWidth)
  } else {
    delete img.dataset.originalWidth
  }
  if (attrs.originalHeight) {
    img.dataset.originalHeight = String(attrs.originalHeight)
  } else {
    delete img.dataset.originalHeight
  }
}

function updateNodeAttributes(editor, getPos, attrs) {
  const pos = typeof getPos === 'function' ? getPos() : null
  if (typeof pos !== 'number') return false

  const { state, view } = editor
  const node = state.doc.nodeAt(pos)
  if (!node) return false

  const tr = state.tr.setNodeMarkup(pos, void 0, {
    ...node.attrs,
    ...attrs,
  })
  view.dispatch(tr)
  return true
}

function cursorForHandle(position) {
  if (position === 'n' || position === 's') return 'ns-resize'
  if (position === 'e' || position === 'w') return 'ew-resize'
  if (position === 'ne' || position === 'sw') return 'nesw-resize'
  return 'nwse-resize'
}

/**
 * ResizableImage Extension for TipTap
 *
 * Extends the standard TipTap Image extension with:
 * - Resize handles (8 positions: corners + edges)
 * - Aspect ratio locking
 * - Min/max size constraints
 * - Keyboard controls
 * - Original dimension tracking
 */
const ResizableImage = Image.extend({
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
      minWidth: MIN_SIZE,
      maxWidth: null, // null = no limit
      aspectRatioLocked: true, // Default to locked
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: element => element.getAttribute('src'),
        renderHTML: attributes => {
          if (!attributes.src) return {}
          return { src: attributes.src }
        },
      },
      alt: {
        default: null,
        parseHTML: element => element.getAttribute('alt'),
        renderHTML: attributes => {
          if (!attributes.alt) return {}
          return { alt: attributes.alt }
        },
      },
      width: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width')
          return width ? parseInt(width, 10) : null
        },
        renderHTML: attributes => {
          if (!attributes.width) return {}
          return { width: String(attributes.width) }
        },
      },
      height: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height')
          return height ? parseInt(height, 10) : null
        },
        renderHTML: attributes => {
          if (!attributes.height) return {}
          return { height: String(attributes.height) }
        },
      },
      originalWidth: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('data-original-width')
          return width ? parseInt(width, 10) : null
        },
        renderHTML: attributes => {
          if (!attributes.originalWidth) return {}
          return { 'data-original-width': String(attributes.originalWidth) }
        },
      },
      originalHeight: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('data-original-height')
          return height ? parseInt(height, 10) : null
        },
        renderHTML: attributes => {
          if (!attributes.originalHeight) return {}
          return { 'data-original-height': String(attributes.originalHeight) }
        },
      },
      aspectRatioLocked: {
        default: true,
        parseHTML: element => {
          const locked = element.getAttribute('data-aspect-ratio-locked')
          return locked === 'false' ? false : true
        },
        renderHTML: attributes => {
          // Don't render this to HTML, it's internal state only
          return {}
        },
      },
    }
  },

  addCommands() {
    return {
      setImage: attributes => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: attributes,
        })
      },
      setImageSize: (width, height) => ({ commands }) => {
        return commands.updateAttributes(this.name, {
          width: width ? Math.round(width) : null,
          height: height ? Math.round(height) : null,
        })
      },
      resetImageSize: () => ({ commands, state }) => {
        const { selection } = state
        const node = state.doc.nodeAt(selection.from)

        if (node && node.type.name === this.name) {
          return commands.updateAttributes(this.name, {
            width: node.attrs.originalWidth || null,
            height: node.attrs.originalHeight || null,
          })
        }
        return false
      },
      toggleImageAspectRatio: () => ({ commands, state }) => {
        const { selection } = state
        const node = state.doc.nodeAt(selection.from)

        if (node && node.type.name === this.name) {
          return commands.updateAttributes(this.name, {
            aspectRatioLocked: !node.attrs.aspectRatioLocked,
          })
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const options = this.options

    return [
      new Plugin({
        key: new PluginKey('resizableImage'),
        props: {
          decorations(state) {
            return null // No decorations needed, using node view
          },
        },
      }),
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node

      const container = document.createElement('div')
      container.className = 'cms-resizable-image-container'
      container.setAttribute('data-drag-handle', '')
      container.setAttribute('data-node-view-wrapper', '')
  container.setAttribute('contenteditable', 'false')

      const wrapper = document.createElement('div')
      wrapper.className = 'cms-resizable-image-wrapper'
  wrapper.setAttribute('contenteditable', 'false')

      const img = document.createElement('img')
      img.className = 'cms-resizable-image'
      img.draggable = false

      syncImageAttributes(img, currentNode.attrs)

      const handleLoad = () => {
        const latestNode = currentNode
        if (!latestNode) return

        const hasOriginalDimensions = latestNode.attrs.originalWidth && latestNode.attrs.originalHeight

        if (!hasOriginalDimensions) {
          updateNodeAttributes(editor, getPos, {
            originalWidth: img.naturalWidth,
            originalHeight: img.naturalHeight,
            width: latestNode.attrs.width || img.naturalWidth,
            height: latestNode.attrs.height || img.naturalHeight,
          })
        } else {
          applyDimensions(
            img,
            latestNode.attrs.width || img.naturalWidth,
            latestNode.attrs.height || img.naturalHeight,
          )
        }
      }

      img.addEventListener('load', handleLoad)

      wrapper.appendChild(img)

      const getCurrentNode = () => currentNode

      // Create resize handles
      const handles = createResizeHandles(img, getCurrentNode, getPos, editor, this.options)
      handles.forEach(handle => wrapper.appendChild(handle))

      container.appendChild(wrapper)

      return {
        dom: container,
        contentDOM: null,
        update: updatedNode => {
          if (updatedNode.type !== node.type) {
            return false
          }

          currentNode = updatedNode
          syncImageAttributes(img, updatedNode.attrs)

          return true
        },
        destroy: () => {
          img.removeEventListener('load', handleLoad)
        },
      }
    }
  },
})

/**
 * Create resize handles for the image
 */
function createResizeHandles(img, getNode, getPos, editor, options) {
  const positions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const handles = []

  positions.forEach(position => {
    const handle = document.createElement('div')
    handle.className = `cms-resize-handle cms-resize-handle--${position}`
    handle.setAttribute('data-position', position)
    handle.setAttribute('tabindex', '0')
    handle.setAttribute('role', 'button')
    handle.setAttribute('aria-label', `Resize image from ${position}`)
  handle.setAttribute('contenteditable', 'false')

    // Mouse resize
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      startResize(e, img, position, getNode, getPos, editor, options)
    })

    // Touch resize
    handle.addEventListener('touchstart', e => {
      e.preventDefault()
      e.stopPropagation()
      startResize(e.touches[0], img, position, getNode, getPos, editor, options)
    })

    // Keyboard resize
    handle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        // Focus the handle for arrow key resizing
        handle.focus()
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        handleKeyboardResize(e, img, position, getNode, getPos, editor, options)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // Reset to original size
        editor.commands.resetImageSize()
      }
    })

    handles.push(handle)
  })

  return handles
}

/**
 * Start mouse/touch resize operation
 */
function startResize(event, img, position, getNode, getPos, editor, options) {
  const node = typeof getNode === 'function' ? getNode() : null
  if (!node) return

  const startX = event.clientX
  const startY = event.clientY

  const { minWidth, maxWidth } = getBounds(img, options)

  const currentWidth = toNumber(node.attrs.width) || img.getBoundingClientRect().width || img.naturalWidth || minWidth
  const currentHeight = toNumber(node.attrs.height) || img.getBoundingClientRect().height || img.naturalHeight || minWidth
  const aspectRatio = currentHeight ? currentWidth / currentHeight : 1
  const isAspectRatioLocked = node.attrs.aspectRatioLocked !== false

  const overlay = document.createElement('div')
  overlay.className = 'cms-resize-overlay'
  overlay.style.cursor = cursorForHandle(position)
  document.body.appendChild(overlay)

  const pos = typeof getPos === 'function' ? getPos() : null
  if (typeof pos === 'number') {
    const { state, view } = editor
    const selection = NodeSelection.create(state.doc, pos)
    view.dispatch(state.tr.setSelection(selection))
    view.focus()
  }

  let latestWidth = currentWidth
  let latestHeight = currentHeight

  const onMove = e => {
    const clientX = e?.clientX ?? e.touches?.[0]?.clientX
    const clientY = e?.clientY ?? e.touches?.[0]?.clientY
    if (clientX == null || clientY == null) return
    if (e.cancelable) {
      e.preventDefault()
    }

    const deltaX = clientX - startX
    const deltaY = clientY - startY

    let newWidth = currentWidth
    let newHeight = currentHeight

    if (position.includes('e')) {
      newWidth = currentWidth + deltaX
    } else if (position.includes('w')) {
      newWidth = currentWidth - deltaX
    }

    if (position.includes('s')) {
      newHeight = currentHeight + deltaY
    } else if (position.includes('n')) {
      newHeight = currentHeight - deltaY
    }

    newWidth = clamp(newWidth, minWidth, maxWidth)

    if (isAspectRatioLocked) {
      newHeight = newWidth / (aspectRatio || 1)
    } else {
      newHeight = Math.max(minWidth, newHeight)
    }

    const originalWidth = toNumber(node.attrs.originalWidth) || img.naturalWidth || newWidth
    const originalHeight = toNumber(node.attrs.originalHeight) || img.naturalHeight || newHeight

    if (Math.abs(newWidth - originalWidth) < SNAP_THRESHOLD) {
      newWidth = originalWidth
      newHeight = originalHeight
    }

    latestWidth = newWidth
    latestHeight = newHeight

    applyDimensions(img, newWidth, newHeight)
  }

  const onEnd = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onEnd)

    overlay.remove()

    updateNodeAttributes(editor, getPos, {
      width: Math.round(latestWidth),
      height: Math.round(latestHeight),
    })
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd)
  document.addEventListener('touchcancel', onEnd)
}

/**
 * Handle keyboard-based resizing
 */
function handleKeyboardResize(event, img, position, getNode, getPos, editor, options) {
  const node = typeof getNode === 'function' ? getNode() : null
  if (!node) return

  const delta = event.shiftKey ? 1 : 10

  const { minWidth, maxWidth } = getBounds(img, options)

  const currentWidth = toNumber(node.attrs.width) || img.getBoundingClientRect().width || img.naturalWidth || minWidth
  const currentHeight = toNumber(node.attrs.height) || img.getBoundingClientRect().height || img.naturalHeight || minWidth
  const aspectRatio = currentHeight ? currentWidth / currentHeight : 1
  const isAspectRatioLocked = node.attrs.aspectRatioLocked !== false

  let newWidth = currentWidth
  let newHeight = currentHeight

  if (event.key === 'ArrowRight') {
    newWidth = currentWidth + delta
  } else if (event.key === 'ArrowLeft') {
    newWidth = currentWidth - delta
  } else if (event.key === 'ArrowDown') {
    if (isAspectRatioLocked) {
      newWidth = currentWidth + delta
    } else {
      newHeight = currentHeight + delta
    }
  } else if (event.key === 'ArrowUp') {
    if (isAspectRatioLocked) {
      newWidth = currentWidth - delta
    } else {
      newHeight = currentHeight - delta
    }
  } else {
    return
  }

  newWidth = clamp(newWidth, minWidth, maxWidth)

  if (isAspectRatioLocked) {
    newHeight = newWidth / (aspectRatio || 1)
  } else {
    newHeight = Math.max(minWidth, newHeight)
  }

  const originalWidth = toNumber(node.attrs.originalWidth) || img.naturalWidth || newWidth
  const originalHeight = toNumber(node.attrs.originalHeight) || img.naturalHeight || newHeight

  if (Math.abs(newWidth - originalWidth) < SNAP_THRESHOLD) {
    newWidth = originalWidth
    newHeight = originalHeight
  }

  applyDimensions(img, newWidth, newHeight)

  updateNodeAttributes(editor, getPos, {
    width: Math.round(newWidth),
    height: Math.round(newHeight),
  })
}

export default ResizableImage
