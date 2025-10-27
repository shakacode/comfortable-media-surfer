import { Node, mergeAttributes } from "@tiptap/core";

const IFRAME_CLASS = "cms-rhino-iframe";

function normalizeAttributes(element) {
  const attrs = {};
  for (const attr of Array.from(element.attributes)) {
    attrs[attr.name] = attr.value ?? "";
  }
  if (!attrs.src) {
    attrs.src = "";
  }
  return attrs;
}

const Iframe = Node.create({
  name: "iframe",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,
  parseHTML() {
    return [
      {
        tag: "iframe"
      }
    ];
  },
  addAttributes() {
    return {
      htmlAttributes: {
        default: {},
        parseHTML: (element) => normalizeAttributes(element),
        renderHTML: (attributes) => attributes || {}
      }
    };
  },
  renderHTML({ HTMLAttributes }) {
    const { htmlAttributes, ...rest } = HTMLAttributes ?? {};
    const merged = mergeAttributes(
      this.options.HTMLAttributes,
      htmlAttributes || {},
      rest
    );
    if (!merged.src) {
      merged.src = "";
    }
    const classes = new Set();
    if (typeof merged.class === "string") {
      merged.class
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => classes.add(token));
    }
    classes.add(IFRAME_CLASS);
    merged.class = Array.from(classes).join(" ");
    return ["iframe", merged];
  },
  renderText({ node }) {
    const attrs = node.attrs.htmlAttributes || {};
    if (attrs.title) {
      return `[embedded content: ${attrs.title}]`;
    }
    return "[embedded content]";
  }
});

export default Iframe;
