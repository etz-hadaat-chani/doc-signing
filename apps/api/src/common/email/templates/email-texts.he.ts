// Every Hebrew line of the three emails. Values are inserted as plain text; the templates escape
// them for HTML. Short and plain on purpose (NFR-DEL-3).

export const emailTexts = {
  greeting: (name: string) => `שלום ${name},`,
  linkFallback: 'אם הכפתור לא נפתח, אפשר להעתיק את הקישור הזה לדפדפן:',
  idCheck: 'לפני הצפייה במסמך יש להקליד את מספר תעודת הזהות.',
  expiry: (date: string) => `הקישור בתוקף עד ${date}.`,
  invitation: {
    subject: (documentName: string) => `מסמך לחתימה: ${documentName}`,
    intro: (documentName: string) => `נשלח אליך המסמך "${documentName}" לחתימה.`,
    action: 'לצפייה במסמך ולחתימה עליו:',
    button: 'לצפייה ולחתימה',
    correction: 'זהו מסמך מתוקן שממתין לחתימתך, במקום המסמך שנשלח אליך קודם.',
  },
  reminder: {
    subject: (documentName: string) => `תזכורת: מסמך ממתין לחתימתך – ${documentName}`,
    intro: (documentName: string) => `המסמך "${documentName}" עדיין ממתין לחתימתך.`,
    action: 'לצפייה במסמך ולחתימה עליו:',
    button: 'לצפייה ולחתימה',
    earlierLinks: 'גם הקישורים שקיבלת קודם ממשיכים לעבוד.',
  },
  signedCopy: {
    subject: (documentName: string) => `העתק המסמך החתום: ${documentName}`,
    intro: (documentName: string) => `תודה, המסמך "${documentName}" נחתם בהצלחה.`,
    attached: 'העתק של המסמך החתום מצורף להודעה זו. מומלץ לשמור אותו.',
  },
  footer: {
    questions: (hrName: string) => `לשאלות אפשר לפנות אל ${hrName}`,
    phone: 'טלפון:',
    email: 'דוא״ל:',
    noReply: 'הודעה זו נשלחה ממערכת החתימות. אין להשיב להודעה זו.',
  },
} as const;
