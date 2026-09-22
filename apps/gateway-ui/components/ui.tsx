'use client';

import { Check, Copy, LoaderCircle, X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${props.className ?? ''}`}
    >
      {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
}) {
  const id = useId();

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  close,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(() => {
    ref.current?.showModal();

    return () => ref.current?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2 id={heading}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-button" type="button" aria-label="Fechar" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-orbit" aria-hidden="true">
        <Mark small />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Secret({
  title,
  value,
  close,
}: {
  title: string;
  value: string;
  close: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal
      title={title}
      description="Guarde este valor agora. Ele não poderá ser consultado novamente."
      close={close}
    >
      <textarea
        className="secret-value"
        aria-label="Valor gerado"
        value={value}
        readOnly
        rows={4}
        spellCheck={false}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setError('Selecione o valor acima e copie manualmente.');
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
        <Button onClick={close}>Já guardei</Button>
      </footer>
    </Modal>
  );
}

export function Confirm({
  title,
  description,
  confirm,
  close,
  busy,
}: {
  title: string;
  description: string;
  confirm: () => void;
  close: () => void;
  busy?: boolean;
}) {
  return (
    <Modal title={title} description={description} close={close}>
      <footer>
        <Button variant="secondary" onClick={close}>
          Cancelar
        </Button>
        <Button variant="danger" busy={busy} onClick={confirm}>
          Confirmar
        </Button>
      </footer>
    </Modal>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
