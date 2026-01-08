import { useEffect, useRef, useState, useCallback } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";

type SaveFn<T> = (value: T, opts?: { signal?: AbortSignal }) => Promise<unknown>;

export function useDebouncedAutosave<T>(
  value: T,
  saveFn: SaveFn<T>,
  opts?: {
    delay?: number;
    validate?: () => boolean; // optional validator; if returns false, skip save
    onSaved?: () => void;
  }
) {
  const { delay = 800, validate, onSaved } = opts || {};
  const timerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef<number>(0);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const savedAtRef = useRef<number | null>(null);

  const doSave = useCallback(
    async (val: T, id: number) => {
      // cancel previous
      if (controllerRef.current) {
        try {
          controllerRef.current.abort();
        } catch {}
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus("saving");
      setErrorMsg(null);
      try {
        await saveFn(val, { signal: controller.signal });
        // only accept result if still latest
        if (reqIdRef.current !== id) return;
        setStatus("saved");
        savedAtRef.current = Date.now();
        if (typeof onSaved === "function") onSaved();
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          // aborted due to newer save -> ignore
          return;
        }
        setStatus("error");
        let message: string;
        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === "string") {
          message = err;
        } else {
          try {
            message = JSON.stringify(err);
          } catch {
            message = String(err);
          }
        }
        setErrorMsg(message);
      } finally {
        // noop
      }
    },
    [saveFn, onSaved]
  );

  useEffect(() => {
    // validation check
    if (validate && !validate()) {
      setStatus("invalid");
      return;
    }

    // bump request id
    const id = ++reqIdRef.current;

    // clear previous timer
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // immediate when delay==0
    if (!delay) {
      void doSave(value, id);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      void doSave(value, id);
      timerRef.current = null;
    }, delay);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // don't abort controller here, let next save abort previous request
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay, validate, doSave]);

  const saveNow = useCallback(() => {
    const id = ++reqIdRef.current;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void doSave(value, id);
  }, [doSave, value]);

  return {
    status,
    errorMsg,
    savedAt: savedAtRef.current,
    saveNow,
  };
}
