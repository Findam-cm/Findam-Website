// Findam referral programme: the text shown on the Refer page.
// Edit these lines to change the programme wording, add a reward amount, or link to a full programme document.
export const REFERRAL_PROGRAMME = {
  name: 'Findam Referral Programme',
  // One line that sums up what the referrer gains.
  promise: 'Refer a landlord to Findam and gain from their homes. When the homes of a landlord you referred are listed and let through Findam, you are rewarded.',
  // Optional: a reward amount, e.g. 'You receive 10% of the first month’s rent for every home let.' Leave empty to hide.
  reward: '',
  // Optional: link to the full programme terms (PDF, Google Doc or a page). Leave empty to hide the button.
  termsUrl: '',
  steps: [
    ['Refer a landlord', 'Send us the landlord’s name, phone number and area using the form below.'],
    ['We contact and verify them', 'The Findam team calls the landlord, checks their homes and helps them list on Findam.'],
    ['Their homes go live', 'Each home is reviewed before it appears on Findam for house seekers.'],
    ['You gain', 'When the landlord’s homes are let through Findam, you are rewarded. We call you on the number you give us.'],
  ],
  rules: [
    'You only gain from landlords you referred and that we accepted.',
    'A landlord can only be referred once; the first accepted referral counts.',
    'Tell the landlord you are referring them, so they expect our call.',
  ],
}
