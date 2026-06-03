import { InteractionRecorder } from './interaction-recorder';

describe('InteractionRecorder', () => {
  it('collects steps pushed via binding', async () => {
    const recorder = new InteractionRecorder();
    let bindingFn: (source: unknown, payload: object) => void = () => {};
    const context = {
      exposeBinding: jest.fn(async (_name: string, fn: typeof bindingFn) => {
        bindingFn = fn;
      }),
      addInitScript: jest.fn(),
      pages: () => [],
      on: jest.fn(),
    };

    await recorder.attach(context);
    bindingFn(null, {
      type: 'click',
      tag: 'a',
      text: 'Home',
      href: 'https://example.com/',
      selector: 'a',
    });

    const steps = recorder.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('click');
    if (steps[0].type === 'click') expect(steps[0].text).toBe('Home');
  });
});
