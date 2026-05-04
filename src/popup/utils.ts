export function sendMessage<T>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("sendMessage failed", chrome.runtime.lastError.message);
          resolve(undefined);
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      console.warn("sendMessage threw", err);
      resolve(undefined);
    }
  });
}
