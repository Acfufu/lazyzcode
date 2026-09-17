// median(nums): the middle value of the sorted numbers.
// - Odd length: the middle element of the sorted array.
// - Even length: the average of the two middle elements.
// - Empty input: returns null.
function median(nums) {
  // BUG: no sorting — only correct when the input is already sorted.
  const mid = Math.floor(nums.length / 2);
  if (nums.length === 0) return null;
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

export { median };
