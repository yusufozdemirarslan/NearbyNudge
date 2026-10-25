import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { useAiName } from "@/hooks/use-account"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { NewCampaignForm } from "./NewCampaignForm"

/** /campaigns/new: the whole setup on one screen (brief 3.5). */
export function NewCampaignPage() {
  useDocumentTitle("New campaign")
  const { name } = useAiName()
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="New campaign"
        description={`Tell us where you sell, who you sell to and what you offer. ${name ?? "The AI"} restates the plan before anything starts, and nothing is sent: you review every email.`}
      />
      <NewCampaignForm />
    </PageContainer>
  )
}
