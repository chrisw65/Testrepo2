export interface FlipbookPage {
  id: number;
  image: string;
  width: number;
  height: number;
}

export type PageTexture = 'smooth' | 'linen' | 'recycled' | 'canvas';
