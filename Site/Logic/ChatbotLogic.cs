using System.Diagnostics;
using System;
using System.Linq;
using System.Text;
namespace Site.Logic
{
    public class ChatbotLogic : IChatbotLogic
    {
        public object GetOpinionsSumamry(int subjectId)
        {
            var mockLines = new[]
            {
                new
                {
                    lineId = 1001,
                    CountryName = "ישראל",
                    MaterialName = "אלומיניום",
                    Opinions = new[]
                    {
                        new { Reviewer = "דני כהן", Department = "רגולציה", Status = "מאושר", Conditions = "ניתן לאשר בכפוף להשלמת מסמך תאימות מעודכן.", ClassifiedConditions = "" },
                        new { Reviewer = "מיכל לוי", Department = "ייצוא", Status = "מאושר בתנאי", Conditions = "", ClassifiedConditions = "נדרש לוודא משתמש קצה מול גורם מוסמך." }
                    }
                },
                new
                {
                    lineId = 1002,
                    CountryName = "גרמניה",
                    MaterialName = "פלדה",
                    Opinions = new[]
                    {
                        new { Reviewer = "יואב פרץ", Department = "סיכונים", Status = "נדחה", Conditions = "חסר מסמך מקור.\r\n\r\nיש להשלים לפני המשך טיפול.", ClassifiedConditions = "" },
                        new { Reviewer = "רותם דיין", Department = "טכנולוגיה", Status = "בטיפול", Conditions = "", ClassifiedConditions = "" }
                    }
                }
            };

            var formattedByLine = mockLines.Select(line =>
            {
                var sb = new StringBuilder();
                sb.Append("מס שורה: ").Append(line.lineId)
                  .Append(", מדינה: ").Append(line.CountryName)
                  .Append(" , מוצר: ").Append(line.MaterialName)
                  .AppendLine()
                  .AppendLine();

                var opinionIndex = 1;
                foreach (var opinion in line.Opinions)
                {
                    sb.Append("חו\"ד מס ").Append(opinionIndex)
                      .Append(" , שם: ").Append(opinion.Reviewer)
                      .Append(" אגף: ").Append(opinion.Department)
                      .Append(" המלצה: ").Append(opinion.Status)
                      .AppendLine();

                    var cleanedConditions = CleanText(opinion.Conditions);
                    if (!string.IsNullOrWhiteSpace(cleanedConditions))
                    {
                        sb.Append("הנמקה: ").Append(cleanedConditions).AppendLine();
                    }

                    var cleanedClassifiedConditions = CleanText(opinion.ClassifiedConditions);
                    if (!string.IsNullOrWhiteSpace(cleanedClassifiedConditions))
                    {
                        sb.Append("הנמקה מסווגת: ").Append(cleanedClassifiedConditions).AppendLine();
                    }

                    sb.AppendLine();
                    opinionIndex++;
                }

                return new
                {
                    line.lineId,
                    text = sb.ToString().TrimEnd()
                };
            }).ToArray();

            return new
            {
                questionId = "opionionsSummary",
                subjectId,
                data = formattedByLine,
                text = string.Join(Environment.NewLine + new string('-', 30) + Environment.NewLine, formattedByLine.Select(x => x.text))
            };
        }

        private static string CleanText(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            var rows = value
                .Replace("\r\n", "\n")
                .Split(new[] { '\n' }, StringSplitOptions.None)
                .Select(x => x.Trim())
                .Where(x => !string.IsNullOrWhiteSpace(x));

            var result = string.Join(" ", rows).Trim();
            return string.IsNullOrWhiteSpace(result) ? null : result;
        }

        public object CreateRecommandationTemplate(int subjectId)
        {
            return new
            {
                questionId = "createRecommantionTemplate",
                subjectId,
                data = new object[0]
            };
        }

        public object getPrevLicensesHistory(int subjectId)
        {
            return new
            {
                questionId = "getPrevLicensesHistory",
                subjectId,
                data = new object[0]
            };
        }

        public object ValidateTotRecommandation(int subjectId, string textToValidate)
        {
            return new
            {
                questionId = "validateTotRecommandation",
                subjectId,
                textToValidate = textToValidate ?? string.Empty,
                data = new object[0]
            };
        }

        public void Test()
        {
            System.Diagnostics.Trace.WriteLine("ChatbotLogic.Test invoked.");
        }
    }
}
