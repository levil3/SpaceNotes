import type { NoteFile } from "../types";

export interface FileTreeNode {
  type: "folder";
  name: string;
  path: string;
  children: Array<FileTreeNode | FileLeaf>;
}

export interface FileLeaf {
  type: "file";
  name: string;
  path: string;
  note: NoteFile;
}

export type FileNode = FileTreeNode | FileLeaf;

export function isHiddenPath(relativePath: string) {
  return relativePath
    .split("/")
    .some((segment) => segment.startsWith("."));
}

export function buildFileTree(files: NoteFile[], directories: string[] = []) {
  const root: FileTreeNode = {
    type: "folder",
    name: "",
    path: "",
    children: [],
  };

  const ensureFolder = (folderPath: string) => {
    const parts = folderPath.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const currentPath = parts.slice(0, index + 1).join("/");
      let folder = current.children.find(
        (child): child is FileTreeNode =>
          child.type === "folder" && child.name === part,
      );
      if (!folder) {
        folder = {
          type: "folder",
          name: part,
          path: currentPath,
          children: [],
        };
        current.children.push(folder);
      }
      current = folder;
    });
  };

  // Empty and asset-only folders need their own index so they can still be
  // navigated and targeted by file-tree context actions.
  directories.forEach(ensureFolder);

  for (const note of files) {
    const parts = note.path.split("/");
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");
      if (isFile) {
        current.children.push({
          type: "file",
          name: part.replace(/\.md$/i, ""),
          path: note.path,
          note,
        });
        return;
      }

      let folder = current.children.find(
        (child): child is FileTreeNode =>
          child.type === "folder" && child.name === part,
      );
      if (!folder) {
        folder = {
          type: "folder",
          name: part,
          path: currentPath,
          children: [],
        };
        current.children.push(folder);
      }
      current = folder;
    });
  }

  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    });
    for (const node of nodes) {
      if (node.type === "folder") {
        sortNodes(node.children);
      }
    }
  };
  sortNodes(root.children);
  return root.children;
}

export function parentFolder(relativePath: string) {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}
