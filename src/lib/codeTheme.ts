import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Lightweight light-theme syntax colors inspired by Typora and Obsidian.
 * CSS variables keep code highlighting consistent with the app's light/dark
 * palettes while CodeMirror uses the same token parser as Crepe.
 */
export const codeBlockTheme = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
      color: "var(--syntax-keyword)",
    },
    {
      tag: [
        tags.string,
        tags.special(tags.string),
        tags.regexp,
        tags.character,
      ],
      color: "var(--syntax-string)",
    },
    {
      tag: [tags.number, tags.bool, tags.null],
      color: "var(--syntax-number)",
    },
    {
      tag: [tags.comment, tags.meta, tags.documentMeta],
      color: "var(--syntax-comment)",
      fontStyle: "italic",
    },
    {
      tag: [tags.function(tags.variableName), tags.labelName],
      color: "var(--syntax-function)",
    },
    {
      tag: [
        tags.typeName,
        tags.className,
        tags.namespace,
        tags.annotation,
        tags.propertyName,
      ],
      color: "var(--syntax-type)",
    },
    {
      tag: [tags.operator, tags.punctuation, tags.separator],
      color: "var(--syntax-operator)",
    },
    {
      tag: [tags.tagName, tags.attributeName, tags.heading],
      color: "var(--syntax-tag)",
    },
    {
      tag: [tags.invalid, tags.deleted],
      color: "var(--syntax-invalid)",
      textDecoration: "underline wavy",
    },
  ]),
);
