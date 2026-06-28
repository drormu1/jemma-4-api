using System;
namespace Site.Logic
{
    public interface IChatbotLogic 
    {
        object ValidateTotRecommandation(int subjectId, string textToValidate);
        object getPrevLicensesHistory(int subjectId);
        object CreateRecommandationTemplate(int subjectId);
        object GetOpinionsSumamry(int subjectId);
        void Test();
    }
}