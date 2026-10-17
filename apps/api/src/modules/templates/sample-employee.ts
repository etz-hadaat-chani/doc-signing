import type { ValuesEmployee } from '../pdf-filler/field-values.js';

/**
 * The made-up employee of the template preview (FR-TPL-3) when no employee is chosen. Every value
 * is filled in, and the name has a hyphen and a number, so the manager can check the Hebrew text
 * and every position. Not a real person; the ID passes the check digit.
 */
export const SAMPLE_EMPLOYEE: ValuesEmployee = {
  firstName: 'שירה',
  lastName: 'כהן-לוי 2',
  idNumber: '012345674',
  employeeNumber: '90001',
  email: 'shira.sample@example.com',
  details: {
    landline: '02-6543210',
    mobile: '050-1234567',
    address: 'הרב קוק 12',
    city: 'בני ברק',
    birthDate: '1990-05-14',
    jobTitle: 'גננת משלימה',
    employmentStatus: 'קבוע',
    jobPercent: 62.5,
    workDays: 'א-ה',
    hoursBaseCode: 1,
    pensionFundA: 'קרן פנסיה לדוגמה א',
    pensionFundB: 'קרן פנסיה לדוגמה ב',
    studyFund: 'קרן השתלמות לדוגמה',
  },
};
