import { parseName, nameFromEmail } from '../lib/nameparser.js';

describe('parseName', () => {
  test('"John Smith" → first: John, last: Smith', () => {
    expect(parseName('John Smith')).toEqual({ first: 'John', last: 'Smith', notes: '' });
  });
  test('"Smith, John" → first: John, last: Smith', () => {
    expect(parseName('Smith, John')).toEqual({ first: 'John', last: 'Smith', notes: '' });
  });
  test('"John A. Smith" drops middle initial', () => {
    expect(parseName('John A. Smith')).toEqual({ first: 'John', last: 'Smith', notes: '' });
  });
  test('"Dr. John Smith" drops prefix', () => {
    expect(parseName('Dr. John Smith')).toEqual({ first: 'John', last: 'Smith', notes: '' });
  });
  test('"John Smith, CPA" drops suffix', () => {
    expect(parseName('John Smith, CPA')).toEqual({ first: 'John', last: 'Smith', notes: '' });
  });
  test('"John Smith, Esq." drops Esq', () => {
    expect(parseName('John Smith, Esq.')).toEqual({ first: 'John', last: 'Smith', notes: '' });
  });
  test('"Atty. Jane Doe, JD" drops prefix and suffix', () => {
    expect(parseName('Atty. Jane Doe, JD')).toEqual({ first: 'Jane', last: 'Doe', notes: '' });
  });
});

describe('nameFromEmail', () => {
  test('"john@domain.com" → first: John, last: "", notes: last name unknown', () => {
    expect(nameFromEmail('john@domain.com')).toEqual({
      first: 'John', last: '', notes: 'last name unknown'
    });
  });
  test('"jsmith@domain.com" → first: "", last: "", notes: first name unknown', () => {
    expect(nameFromEmail('jsmith@domain.com')).toEqual({
      first: '', last: '', notes: 'first name unknown — review before sending'
    });
  });
  test('"john.smith@domain.com" → first: John, last: Smith', () => {
    expect(nameFromEmail('john.smith@domain.com')).toEqual({
      first: 'John', last: 'Smith', notes: ''
    });
  });
  test('"j.smith@domain.com" → first: "", last: Smith, notes: first name unknown', () => {
    expect(nameFromEmail('j.smith@domain.com')).toEqual({
      first: '', last: 'Smith', notes: 'first name unknown — review before sending'
    });
  });
});
