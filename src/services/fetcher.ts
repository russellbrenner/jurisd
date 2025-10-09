export interface FetchResponse {
  text: string;
  contentType: string;
  sourceUrl: string;
  ocrUsed: boolean;
  metadata?: Record<string, string>;
}

export async function fetchDocumentText(url: string): Promise<FetchResponse> {
  void url;
  // TODO: Implement network fetch and OCR fallback.
  return {
    text: "",
    contentType: "",
    sourceUrl: url,
    ocrUsed: false,
  };
}
