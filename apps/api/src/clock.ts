// Single source of "now" for the services, so tests can pin the time
// with vi.spyOn(clock, "now").
export const clock = {
  now: (): Date => new Date(),
};
