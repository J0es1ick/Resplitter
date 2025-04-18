export interface OCRResponse {
  result?: {
    textAnnotation?: {
      blocks?: Array<{
        boundingBox?: {
          vertices?: Array<{ x: string; y: string }>;
        };
        lines?: Array<{
          boundingBox?: {
            vertices?: Array<{ x: string; y: string }>;
          };
          text?: string;
          words?: Array<{
            text?: string;
          }>;
        }>;
      }>;
    };
  };
}
