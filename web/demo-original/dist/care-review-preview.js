import { createCareReview } from './care-review.js';
import { EXAMPLES } from './care-review-fixtures.js';

const root = document.getElementById('care-review-root');
const select = document.getElementById('care-example');
const announcement = document.getElementById('care-preview-status');
const review = createCareReview(root, { synthetic: true });
for (const [key, example] of Object.entries(EXAMPLES)) {
  const option = document.createElement('option'); option.value = key; option.textContent = example.label; select.append(option);
}
function load() {
  review.show(EXAMPLES[select.value].make());
  announcement.textContent = `${EXAMPLES[select.value].label} example loaded. Previous draft cleared.`;
}
select.addEventListener('change', load);
document.getElementById('care-clear').addEventListener('click', () => {
  review.clear(); announcement.textContent = 'Review and draft cleared. Choose or reload an example to start again.';
});
document.getElementById('care-reload').addEventListener('click', load);
window.addEventListener('pagehide', () => review.clear());
load();
