import React, { useContext } from 'react';
import { AppContext } from '@/context/AppContext';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Building2, Layers, DoorOpen } from 'lucide-react';

interface ViewerBreadcrumbProps {
  buildingFmGuid: string;
  /** Currently isolated floor name */
  floorName?: string | null;
  /** Currently selected room/space name */
  roomName?: string | null;
  onBuildingClick?: () => void;
  onFloorClick?: () => void;
}

const ViewerBreadcrumb: React.FC<ViewerBreadcrumbProps> = ({
  buildingFmGuid,
  floorName,
  roomName,
  onBuildingClick,
  onFloorClick,
}) => {
  const { navigatorTreeData } = useContext(AppContext);
  const building = navigatorTreeData.find((b) => b.fmGuid === buildingFmGuid);
  const buildingName = building?.commonName || building?.name || 'Building';

  return (
    <Breadcrumb className="px-3 py-1.5 text-xs">
      <BreadcrumbList>
        {/* Building */}
        <BreadcrumbItem>
          <BreadcrumbLink
            className="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={onBuildingClick}
          >
            <Building2 className="h-3 w-3" />
            <span className="max-w-[140px] truncate">{buildingName}</span>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {/* Floor */}
        {floorName && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {roomName ? (
                <BreadcrumbLink
                  className="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={onFloorClick}
                >
                  <Layers className="h-3 w-3" />
                  <span className="max-w-[120px] truncate">{floorName}</span>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  <span className="max-w-[120px] truncate">{floorName}</span>
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        )}

        {/* Room */}
        {roomName && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="flex items-center gap-1">
                <DoorOpen className="h-3 w-3" />
                <span className="max-w-[120px] truncate">{roomName}</span>
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export default ViewerBreadcrumb;
