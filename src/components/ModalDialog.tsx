import { useEffect, useRef } from "react";

interface ModalDialogProps {
  title: string;
  description?: string;
  inputLabel?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  danger?: boolean;
  onValueChange?(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}

export function ModalDialog({
  title,
  description,
  inputLabel,
  value,
  placeholder,
  confirmText = "确定",
  danger = false,
  onValueChange,
  onCancel,
  onConfirm,
}: ModalDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Modal callbacks are inline functions, so the keyboard listener effect
  // reruns after every controlled-input update. Initial text selection must be
  // mount-only or each keystroke replaces the user's new value.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    } else {
      dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
    return () => {
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) {
        return;
      }
      // Keep keyboard focus inside the dialog: Tab must not walk into the
      // background page while the dialog is up.
      if (event.key === "Tab") {
        const focusable = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
          ) || []),
        ];
        if (!focusable.length) {
          return;
        }
        const currentIndex = focusable.indexOf(
          document.activeElement as HTMLElement,
        );
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? focusable.length - 1
            : currentIndex - 1
          : currentIndex === focusable.length - 1
            ? 0
            : currentIndex + 1;
        event.preventDefault();
        focusable[nextIndex]?.focus();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Enter") {
        return;
      }
      // A focused button already handles Enter through its click handler.
      // Confirming here as well would cancel and confirm in the same keystroke.
      if (
        event.target instanceof Element &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      onConfirm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="modal-title">{title}</h2>
        {description ? <p>{description}</p> : null}
        {inputLabel ? (
          <label className="modal-field">
            <span>{inputLabel}</span>
            <input
              ref={inputRef}
              value={value}
              placeholder={placeholder}
              onChange={(event) => onValueChange?.(event.target.value)}
            />
          </label>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={danger ? "danger-action" : "primary-action"}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
