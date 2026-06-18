using Newtonsoft.Json.Linq;

namespace Mod.CommissionsNG.Web45.Models
{
    public class ChatRequest
    {
        public string Message { get; set; }
        public string QuestionId { get; set; }
        public JObject Context { get; set; }
    }
}
