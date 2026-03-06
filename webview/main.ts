import { AsciiEditor } from "./ascii/AsciiEditor";
import type { ExtToWebviewMessage, WebviewToExtMessage } from "./shared";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

(function mainIIFE() {
  const __vscode_main = acquireVsCodeApi();

  function __postMessage_main(message: WebviewToExtMessage): void {
    __vscode_main.postMessage(message);
  }

  const __canvas_main = document.getElementById("canvas") as HTMLCanvasElement;
  const __saveButton_main = document.getElementById("btn-save") as HTMLButtonElement;
  const __closeButton_main = document.getElementById("btn-close") as HTMLButtonElement;
  const __status_main = document.getElementById("status") as HTMLElement;

  const __editor_main = new AsciiEditor(
    __canvas_main,
    { saveButton: __saveButton_main, closeButton: __closeButton_main, status: __status_main },
    {
      onSave: (content, closeAfterSave) => {
        __postMessage_main({ command: closeAfterSave ? "saveAndClose" : "save", content });
      },
      onClose: () => {
        __postMessage_main({ command: "close" });
      },
    },
  );

  window.addEventListener("message", (event: MessageEvent<ExtToWebviewMessage>) => {
    const message = event.data;
    if (message.command !== "init") {
      return;
    }
    __editor_main.load(message.content ?? "");
  });

  __canvas_main.focus();
  __postMessage_main({ command: "ready" });
})();
