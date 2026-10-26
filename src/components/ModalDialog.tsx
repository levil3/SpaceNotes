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

  // Modal callbacks are inline functions, so the keyboard listener effect
  // reruns after every controlled-input update. Initial text selection must be
  // mount-only or each keystroke replaces the user's new value.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
      if (event.key === "Enter") {
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
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
