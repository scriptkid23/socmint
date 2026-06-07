/** A single user interaction captured during a recording session. */
export type RecordedStep =
  | {
      type: 'navigate';
      url: string;
      title?: string;
      at: string;
    }
  | {
      type: 'click';
      tag: string;
      text: string;
      href: string | null;
      selector: string;
      at: string;
    }
  | {
      type: 'type';
      tag: string;
      text: string;
      selector: string;
      value: string;
      at: string;
    }
  | {
      type: 'scroll';
      direction: 'up' | 'down';
      at: string;
    };
