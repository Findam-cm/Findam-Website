// Findam referral programme: the text shown on the Refer page.
// Edit these lines to change the programme wording, add a reward amount, or link to a full programme document.
export const REFERRAL_PROGRAMME = {
  name: 'Findam Referral Programme',
  // One line that sums up what the referrer gains.
  promise: 'Refer a landlord to Findam and gain from their homes. When Findam has visited and confirmed a home of a landlord you referred, the landlord pays you a referral reward, straight to your Mobile Money.',
  // Optional: a reward amount, e.g. 'You receive 10% of the first month’s rent for every home let.' Leave empty to hide.
  reward: '',
  // Optional: link to the full programme terms (PDF, Google Doc or a page). Leave empty to hide the button.
  termsUrl: '',
  steps: [
    ['Refer a landlord', 'Send us the landlord’s name, phone number and area using the form below.'],
    ['We verify and list their homes', 'The Findam team calls the landlord, checks their homes and helps them list on Findam.'],
    ['We visit and confirm', 'Findam visits the home and confirms it. The landlord then gets a secure link to pay your referral reward.'],
    ['You gain', 'The landlord pays with MTN Mobile Money or Orange Money, and Findam sends the reward to your Mobile Money number.'],
  ],
  rules: [
    'You only gain from landlords you referred and that we accepted.',
    'The reward is paid by the landlord, after Findam has visited and confirmed their home.',
    'A landlord can only be referred once; the first accepted referral counts.',
    'Give a Mobile Money number (MTN or Orange) that is in your name, so the reward reaches you.',
  ],
}
