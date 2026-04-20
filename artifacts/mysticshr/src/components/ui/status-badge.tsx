import { Badge } from "@/components/ui/badge";

export function EmployeeStatusBadge({ status }: { status: string }) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";
  let colorClass = "";

  switch (status) {
    case "Active":
      colorClass = "bg-green-500 hover:bg-green-600 text-white border-transparent";
      break;
    case "Pre-Joining":
      colorClass = "bg-blue-500 hover:bg-blue-600 text-white border-transparent";
      break;
    case "On Leave of Absence":
      colorClass = "bg-yellow-500 hover:bg-yellow-600 text-white border-transparent";
      break;
    case "Suspended":
    case "Separated":
      colorClass = "bg-red-500 hover:bg-red-600 text-white border-transparent";
      break;
    case "Notice Period":
      colorClass = "bg-orange-500 hover:bg-orange-600 text-white border-transparent";
      break;
    default:
      variant = "outline";
  }

  return (
    <Badge variant={variant} className={colorClass}>
      {status}
    </Badge>
  );
}
