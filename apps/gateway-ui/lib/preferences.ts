export const preferenceOptions = {
  motion: ['system', 'reduced'],
  text: ['default', 'large'],
} as const;
export type Preference = keyof typeof preferenceOptions;
export const preferencesBootstrap = `try{for(var k of ['motion','text']){var v=localStorage.getItem('jian.'+k);if(({motion:['system','reduced'],text:['default','large']})[k].includes(v))document.documentElement.dataset[k]=v}}catch{}`;
