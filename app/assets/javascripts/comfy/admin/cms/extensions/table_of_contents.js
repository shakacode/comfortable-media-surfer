import { Node, mergeAttributes } from "@tiptap/core";

function buildList(items = [], depth = 1) {
  const listClass = [
    "cms-toc-block__list",
    `cms-toc-block__list--depth-${depth}`
  ].join(" ");

  const list = ["ul", { class: listClass, role: "list" }];

  items.forEach((item) => {
    const level = item.level || depth || 1;
    const itemClasses = [
      "cms-toc-block__item",
      `cms-toc-block__item--level-${level}`
    ];

    if (item.depth) {
      itemClasses.push(`cms-toc-block__item--depth-${item.depth}`);
    }

    if (item.isActive) {
      itemClasses.push("is-active");
    }
    if (item.isScrolled) {
      itemClasses.push("is-scrolled");
    }

    const linkAttrs = {
      class: "cms-toc-block__link",
      href: item.id ? `#${item.id}` : "#",
      title: item.text || ""
    };

    const listItem = [
      "li",
      { class: itemClasses.join(" "), role: "listitem" },
      ["a", linkAttrs, item.text || "Untitled section"]
    ];

    if (item.children && item.children.length) {
      listItem.push(buildList(item.children, depth + 1));
    }

    list.push(listItem);
  });

  return list;
}

const CmsTableOfContents = Node.create({
  name: "cmsTableOfContents",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  defining: true,

  addOptions() {
    return {
      title: "On this page",
      emptyMessage: "Add headings to populate the table of contents.",
      HTMLAttributes: {}
    };
  },

  addAttributes() {
    return {
      items: {
        default: "[]",
        parseHTML: (element) => element.getAttribute("data-cms-toc-items") || "[]",
        renderHTML: (attributes) => ({
          "data-cms-toc-items": attributes.items || "[]"
        })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "nav[data-cms-toc]"
      }
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const navAttributes = mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      {
        "data-cms-toc": "true",
        class: [
          "cms-toc-block",
          this.options.HTMLAttributes?.class,
          HTMLAttributes?.class
        ]
          .filter(Boolean)
          .join(" "),
        role: "navigation",
        "aria-label": this.options.title || "Table of contents"
      }
    );

    const rawItems = typeof node.attrs.items === "string" ? node.attrs.items : "[]";
    let items;

    try {
      items = JSON.parse(rawItems);
    } catch (_error) {
      items = [];
    }

    const list = items.length
      ? buildList(items)
      : ["p", { class: "cms-toc-block__empty" }, this.options.emptyMessage];

    return [
      "nav",
      navAttributes,
      ["p", { class: "cms-toc-block__title" }, this.options.title],
      list
    ];
  }
});

export default CmsTableOfContents;
